import type { ControlFrame, EncryptedSession } from './mqttCrypto';

/**
 * Reliable, ordered delivery on top of the public MQTT relay, which only offers
 * "fire and forget" (QoS 0). Every data message gets a sequence number; the receiver delivers
 * them in order, drops duplicates and acknowledges what it has (cumulative acks); the sender
 * re-sends anything not acknowledged in time. So a vote or night choice is never silently
 * lost, and an older game state can never overwrite a newer one.
 */
export interface ReliableLinkOptions {
  /** Re-send a message if it isn't acknowledged within this long. */
  resendAfterMs?: number;
  /** Give up (and report the link as broken) after this many sends of one message. */
  maxSends?: number;
  /** How far ahead of the next expected message we buffer out-of-order arrivals. */
  window?: number;
}

export class ReliableLink {
  private nextTxSeq = 1;
  private unacked = new Map<number, { data: unknown; sentAt: number; sends: number }>();
  private nextRxSeq = 1;
  private reorder = new Map<number, unknown>();
  private txChain: Promise<void> = Promise.resolve();
  private ackTimer: ReturnType<typeof setTimeout> | null = null;
  private resendTimer: ReturnType<typeof setInterval> | null = null;
  private closed = false;
  private readonly resendAfterMs: number;
  private readonly maxSends: number;
  private readonly window: number;

  constructor(
    private readonly session: EncryptedSession,
    private readonly publish: (wire: string) => void,
    private readonly handlers: {
      onData: (data: unknown) => void;
      onControl: (frame: ControlFrame) => void;
      onBroken: () => void;
    },
    opts: ReliableLinkOptions = {},
  ) {
    this.resendAfterMs = opts.resendAfterMs ?? 1200;
    this.maxSends = opts.maxSends ?? 15;
    this.window = opts.window ?? 256;
    this.resendTimer = setInterval(() => this.resendDue(), Math.max(50, Math.floor(this.resendAfterMs / 2)));
  }

  /** Messages sent but not yet acknowledged (for tests and diagnostics). */
  get pending(): number {
    return this.unacked.size;
  }

  send(data: unknown) {
    if (this.closed) return;
    const seq = this.nextTxSeq++;
    this.unacked.set(seq, { data, sentAt: Date.now(), sends: 1 });
    this.transmit(seq, data);
  }

  control(frame: ControlFrame) {
    if (this.closed) return;
    this.enqueue(() => this.session.sealControl(frame));
  }

  /** Handles one raw frame from the relay. Returns false if it wasn't a valid frame for us. */
  async receive(raw: string): Promise<boolean> {
    const opened = await this.session.open(raw);
    if (!opened || this.closed) return false;
    if (opened.ch === 'c') {
      if (opened.frame.k === 'ack') {
        for (const seq of this.unacked.keys()) if (seq <= opened.frame.upTo) this.unacked.delete(seq);
      } else {
        this.handlers.onControl(opened.frame);
      }
      return true;
    }
    const { seq, data } = opened;
    if (seq < this.nextRxSeq) {
      // Already delivered: our ack was probably lost, so acknowledge again.
      this.scheduleAck();
      return true;
    }
    if (seq >= this.nextRxSeq + this.window) return true;
    this.reorder.set(seq, data);
    while (this.reorder.has(this.nextRxSeq)) {
      const next = this.reorder.get(this.nextRxSeq);
      this.reorder.delete(this.nextRxSeq);
      this.nextRxSeq++;
      this.handlers.onData(next);
    }
    this.scheduleAck();
    return true;
  }

  close() {
    this.closed = true;
    if (this.ackTimer) clearTimeout(this.ackTimer);
    if (this.resendTimer) clearInterval(this.resendTimer);
    this.ackTimer = null;
    this.resendTimer = null;
    this.unacked.clear();
    this.reorder.clear();
  }

  /** Sends a final control frame, then closes. */
  async closeWith(frame: ControlFrame): Promise<void> {
    if (this.closed) return;
    this.control(frame);
    const done = this.txChain;
    this.close();
    await done;
  }

  private transmit(seq: number, data: unknown) {
    this.enqueue(() => this.session.sealData(seq, data));
  }

  /** Encryption is async; a chain keeps frames leaving in the order they were queued. */
  private enqueue(seal: () => Promise<string>) {
    this.txChain = this.txChain
      .then(async () => {
        const wire = await seal();
        this.publish(wire);
      })
      .catch(() => {});
  }

  private scheduleAck() {
    if (this.ackTimer || this.closed) return;
    // Batch acknowledgements for messages that arrive together.
    this.ackTimer = setTimeout(() => {
      this.ackTimer = null;
      this.control({ k: 'ack', upTo: this.nextRxSeq - 1 });
    }, 25);
  }

  private resendDue() {
    if (this.closed) return;
    const now = Date.now();
    for (const [seq, entry] of this.unacked) {
      if (now - entry.sentAt < this.resendAfterMs) continue;
      if (entry.sends >= this.maxSends) {
        this.handlers.onBroken();
        return;
      }
      entry.sends++;
      entry.sentAt = now;
      this.transmit(seq, entry.data);
    }
  }
}
