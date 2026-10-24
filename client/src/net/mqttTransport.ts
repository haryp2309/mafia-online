import {
  deriveRoomKeys,
  deriveSessionKey,
  EncryptedSession,
  encryptHandshake,
  decryptHandshake,
  generateEphemeralKeyPair,
  HandshakeReplayGuard,
  randomHex,
  type HandshakeBye,
  type HandshakeSyn,
  type HandshakeSynAck,
} from './mqttCrypto';
import { ReliableLink, type ReliableLinkOptions } from './mqttReliable';
import {
  encodeConnect,
  encodeDisconnect,
  encodePingReq,
  encodePublish,
  encodeSubscribe,
  MqttStreamDecoder,
} from './mqttPacket';

/**
 * Public MQTT-over-WebSockets (wss://) brokers used for automatic fallback when direct
 * WebRTC (PeerJS) fails or is blocked by a strict firewall / Symmetric NAT.
 */
export const DEFAULT_MQTT_BROKERS = [
  'wss://broker.emqx.io:8084/mqtt',
  'wss://test.mosquitto.org:8081',
  'wss://broker.hivemq.com:8884/mqtt',
] as const;

const decoder = new TextDecoder();
const encoder = new TextEncoder();

export interface WebSocketLike {
  binaryType: string;
  readonly readyState: number;
  onopen: (() => void) | null;
  onmessage: ((ev: { data: ArrayBuffer | Uint8Array }) => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
  send(data: Uint8Array): void;
  close(): void;
}

export type WebSocketFactory = (url: string, protocols?: string | string[]) => WebSocketLike;

const defaultWsFactory: WebSocketFactory = (url, protocols) =>
  new WebSocket(url, protocols) as unknown as WebSocketLike;

/**
 * Duck-types the subset of PeerJS `DataConnection` used by HostRuntime and PlayerRuntime.
 */
export interface PeerConnectionLike {
  readonly connectionId: string;
  readonly open: boolean;
  readonly relayed?: boolean;
  send(data: unknown): void;
  close(): void;
  on(event: 'open', cb: () => void): unknown;
  on(event: 'data', cb: (data: unknown) => void): unknown;
  on(event: 'close', cb: () => void): unknown;
  on(event: 'error', cb: (err?: unknown) => void): unknown;
}

class EventHub {
  private openListeners: (() => void)[] = [];
  private dataListeners: ((data: unknown) => void)[] = [];
  private closeListeners: (() => void)[] = [];
  private errorListeners: (() => void)[] = [];

  on(event: 'open' | 'close' | 'error', cb: () => void): void;
  on(event: 'data', cb: (data: unknown) => void): void;
  on(event: 'open' | 'data' | 'close' | 'error', cb: ((data?: unknown) => void)): void {
    if (event === 'open') this.openListeners.push(cb as () => void);
    else if (event === 'data') this.dataListeners.push(cb);
    else if (event === 'close') this.closeListeners.push(cb as () => void);
    else if (event === 'error') this.errorListeners.push(cb as () => void);
  }

  emitOpen() {
    for (const l of this.openListeners) l();
  }
  emitData(d: unknown) {
    for (const l of this.dataListeners) l(d);
  }
  emitClose() {
    for (const l of this.closeListeners) l();
  }
  emitError() {
    for (const l of this.errorListeners) l();
  }
}

/**
 * Low-level MQTT-over-WebSocket connection to a single broker.
 */
class MqttBrokerSocket {
  private ws: WebSocketLike | null = null;
  private stream = new MqttStreamDecoder();
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private packetId = 1;
  private connected = false;
  private closed = false;

  constructor(
    readonly url: string,
    private readonly clientId: string,
    private readonly subscriptions: string[],
    private readonly onMessage: (topic: string, payload: string) => void,
    private readonly onStatus: (connected: boolean) => void,
    private readonly wsFactory: WebSocketFactory,
    private readonly will?: { topic: string; payload: Uint8Array },
  ) {
    this.connect();
  }

  get isConnected() {
    return this.connected;
  }

  private connect() {
    if (this.closed) return;
    try {
      const ws = this.wsFactory(this.url, 'mqtt');
      ws.binaryType = 'arraybuffer';
      this.ws = ws;

      ws.onopen = () => {
        if (this.closed || ws !== this.ws) return;
        ws.send(
          encodeConnect({
            clientId: this.clientId,
            keepAliveSec: 25,
            will: this.will,
          }),
        );
      };

      ws.onmessage = (ev) => {
        if (this.closed || ws !== this.ws) return;
        const bytes = ev.data instanceof Uint8Array ? ev.data : new Uint8Array(ev.data);
        for (const pkt of this.stream.push(bytes)) {
          if (pkt.type === 'connack' && pkt.returnCode === 0) {
            this.connected = true;
            if (this.subscriptions.length > 0) {
              ws.send(encodeSubscribe(this.packetId++, this.subscriptions));
            }
            this.startPing();
            this.onStatus(true);
          } else if (pkt.type === 'publish') {
            this.onMessage(pkt.topic, decoder.decode(pkt.payload));
          }
        }
      };

      const handleDisconnect = () => {
        if (ws !== this.ws) return;
        const wasConnected = this.connected;
        this.connected = false;
        this.stopPing();
        if (wasConnected) this.onStatus(false);
      };

      ws.onclose = handleDisconnect;
      ws.onerror = handleDisconnect;
    } catch {
      this.onStatus(false);
    }
  }

  publish(topic: string, payload: string | Uint8Array) {
    if (!this.connected || !this.ws || this.ws.readyState !== 1) return false;
    try {
      this.ws.send(encodePublish(topic, payload));
      return true;
    } catch {
      return false;
    }
  }

  private startPing() {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      if (this.connected && this.ws && this.ws.readyState === 1) {
        try {
          this.ws.send(encodePingReq());
        } catch {
          // Ignore send errors; onclose will fire
        }
      }
    }, 15_000);
  }

  private stopPing() {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  close() {
    this.closed = true;
    this.stopPing();
    if (this.ws) {
      try {
        if (this.connected && this.ws.readyState === 1) {
          this.ws.send(encodeDisconnect());
        }
        this.ws.close();
      } catch {
        // Ignore
      }
      this.ws = null;
    }
    this.connected = false;
  }
}

// ---------- Host-side MQTT server & per-client connection adapter ----------

export interface MqttHostOptions {
  brokers?: readonly string[];
  wsFactory?: WebSocketFactory;
  heartbeatTimeoutMs?: number;
  link?: ReliableLinkOptions;
  onConnection: (conn: PeerConnectionLike) => void;
  onStatusChange?: (online: boolean) => void;
}

class HostClientAdapter extends EventHub implements PeerConnectionLike {
  readonly relayed = true;
  open = true;
  lastSeen = Date.now();
  readonly link: ReliableLink;

  constructor(
    readonly connectionId: string,
    readonly clientId: string,
    readonly clientNonce: string,
    session: EncryptedSession,
    publishToClient: (payload: string) => void,
    private readonly onClosed: (clientId: string) => void,
    linkOptions?: ReliableLinkOptions,
  ) {
    super();
    this.link = new ReliableLink(
      session,
      publishToClient,
      {
        onData: (d) => this.emitData(d),
        onControl: (frame) => {
          if (frame.k === 'ping') this.link.control({ k: 'pong' });
          else if (frame.k === 'bye') this.close();
        },
        onBroken: () => this.close(),
      },
      linkOptions,
    );
  }

  send(data: unknown) {
    if (this.open) this.link.send(data);
  }

  close() {
    if (!this.open) return;
    this.open = false;
    this.link.close();
    this.onClosed(this.clientId);
    this.emitClose();
  }
}

export class MqttHostServer {
  private sockets = new Map<string, MqttBrokerSocket>();
  private clients = new Map<string, { adapter: HostClientAdapter; brokerUrl: string }>();
  private replayGuard = new HandshakeReplayGuard();
  private sweepTimer: ReturnType<typeof setInterval> | null = null;
  private retryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private destroyed = false;
  private topicHash = '';

  constructor(
    private roomCode: string,
    private secret: string,
    private readonly opts: MqttHostOptions,
  ) {
    void this.init();
  }

  get isOnline(): boolean {
    for (const s of this.sockets.values()) if (s.isConnected) return true;
    return false;
  }

  private async init() {
    const keys = await deriveRoomKeys(this.roomCode, this.secret);
    if (this.destroyed) return;
    this.topicHash = keys.topicHash;

    const brokers = this.opts.brokers ?? DEFAULT_MQTT_BROKERS;
    const wsFactory = this.opts.wsFactory ?? defaultWsFactory;

    for (const url of brokers) {
      this.connectBroker(url, keys.topicHash, keys.roomAuthKey, wsFactory);
    }

    const timeoutMs = this.opts.heartbeatTimeoutMs ?? 16_000;
    this.sweepTimer = setInterval(() => {
      const now = Date.now();
      for (const { adapter } of this.clients.values()) {
        if (now - adapter.lastSeen > timeoutMs) {
          adapter.close();
        }
      }
    }, Math.min(3000, Math.floor(timeoutMs / 3)));
  }

  private connectBroker(
    url: string,
    topicHash: string,
    roomAuthKey: CryptoKey,
    wsFactory: WebSocketFactory,
  ) {
    if (this.destroyed) return;
    const joinTopic = `mfo/v2/${topicHash}/join`;
    const clientWildcard = `mfo/v2/${topicHash}/h/+`;
    const hostMqttId = `mfo-h-${randomHex(6)}`;

    const sock = new MqttBrokerSocket(
      url,
      hostMqttId,
      [joinTopic, clientWildcard],
      (topic, payload) => {
        void this.handleIncoming(url, topicHash, roomAuthKey, topic, payload);
      },
      (connected) => {
        if (this.destroyed) return;
        this.opts.onStatusChange?.(this.isOnline);
        if (!connected) {
          const prev = this.retryTimers.get(url);
          if (prev) clearTimeout(prev);
          this.retryTimers.set(
            url,
            setTimeout(() => this.connectBroker(url, topicHash, roomAuthKey, wsFactory), 3500),
          );
        }
      },
      wsFactory,
    );
    this.sockets.set(url, sock);
  }

  private async handleIncoming(
    brokerUrl: string,
    topicHash: string,
    roomAuthKey: CryptoKey,
    topic: string,
    payload: string,
  ) {
    if (this.destroyed) return;
    const joinPrefix = `mfo/v2/${topicHash}/join`;
    const dataPrefix = `mfo/v2/${topicHash}/h/`;

    if (topic === joinPrefix) {
      const syn = await decryptHandshake<HandshakeSyn>(roomAuthKey, topicHash, 'syn', payload);
      if (!syn || !syn.clientId || !syn.clientPub || !syn.clientNonce) return;
      if (!this.replayGuard.checkAndRecord(syn)) return;

      const hostKp = await generateEphemeralKeyPair();
      const sessionId = randomHex(12);
      const hostNonce = randomHex(12);
      let sessionKey: CryptoKey;
      try {
        sessionKey = await deriveSessionKey(
          hostKp.privateKey,
          syn.clientPub,
          this.roomCode.trim().toUpperCase(),
          syn.clientId,
          sessionId,
          syn.clientNonce,
          hostNonce,
        );
      } catch {
        return;
      }
      if (this.destroyed) return;

      // Close any previous session from the same clientId
      const existing = this.clients.get(syn.clientId);
      if (existing) existing.adapter.close();

      const session = new EncryptedSession(sessionId, sessionKey, 'h2c', 'c2h');
      const clientDownTopic = `mfo/v2/${topicHash}/c/${syn.clientId}`;

      const synAck: HandshakeSynAck = {
        t: 'syn-ack',
        clientId: syn.clientId,
        sessionId,
        hostPub: hostKp.publicKeyB64,
        clientNonce: syn.clientNonce,
        hostNonce,
      };
      const encAck = await encryptHandshake(roomAuthKey, topicHash, synAck);
      this.publishTo(brokerUrl, clientDownTopic, encAck);

      const adapter = new HostClientAdapter(
        `mqtt-${syn.clientId}-${sessionId.slice(0, 6)}`,
        syn.clientId,
        syn.clientNonce,
        session,
        (msg) => this.publishTo(brokerUrl, clientDownTopic, msg),
        (cid) => {
          const cur = this.clients.get(cid);
          if (cur?.adapter === adapter) this.clients.delete(cid);
        },
        this.opts.link,
      );

      this.clients.set(syn.clientId, { adapter, brokerUrl });
      this.opts.onConnection(adapter);
      adapter.emitOpen();
      return;
    }

    if (topic.startsWith(dataPrefix)) {
      const clientId = topic.slice(dataPrefix.length);
      const entry = this.clients.get(clientId);
      if (!entry) return;
      // Update active broker route if client switched
      entry.brokerUrl = brokerUrl;
      if (await entry.adapter.link.receive(payload)) {
        entry.adapter.lastSeen = Date.now();
        return;
      }
      // Not a session frame: maybe the authenticated Last Will the broker sends when a phone vanishes.
      const lwt = await decryptHandshake<HandshakeBye>(roomAuthKey, topicHash, 'bye', payload);
      if (lwt && lwt.clientId === clientId && lwt.clientNonce === entry.adapter.clientNonce) {
        entry.adapter.close();
      }
    }
  }

  private publishTo(preferredBroker: string, topic: string, payload: string) {
    const preferred = this.sockets.get(preferredBroker);
    if (preferred?.publish(topic, payload)) return;
    for (const sock of this.sockets.values()) {
      if (sock.publish(topic, payload)) return;
    }
  }

  setRoom(newRoomCode: string, newSecret: string) {
    this.destroy();
    this.destroyed = false;
    this.roomCode = newRoomCode;
    this.secret = newSecret;
    void this.init();
  }

  destroy() {
    this.destroyed = true;
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    this.sweepTimer = null;
    for (const t of this.retryTimers.values()) clearTimeout(t);
    this.retryTimers.clear();
    for (const { adapter } of this.clients.values()) adapter.close();
    this.clients.clear();
    for (const s of this.sockets.values()) s.close();
    this.sockets.clear();
    void this.topicHash;
  }
}

// ---------- Client-side MQTT DataConnection adapter ----------

export interface MqttClientOptions {
  brokers?: readonly string[];
  wsFactory?: WebSocketFactory;
  brokerAttemptTimeoutMs?: number;
  heartbeatIntervalMs?: number;
  heartbeatTimeoutMs?: number;
  link?: ReliableLinkOptions;
}

export class MqttClientConnection extends EventHub implements PeerConnectionLike {
  readonly connectionId = `mqtt-c-${randomHex(6)}`;
  readonly relayed = true;
  open = false;

  private readonly clientId = randomHex(8);
  private sock: MqttBrokerSocket | null = null;
  private link: ReliableLink | null = null;
  private topicHash = '';
  private closed = false;
  private attemptTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private lastHostSeen = 0;

  constructor(
    private readonly roomCode: string,
    private readonly secret: string,
    private readonly opts: MqttClientOptions = {},
  ) {
    super();
    void this.start();
  }

  private async start() {
    let keys;
    try {
      keys = await deriveRoomKeys(this.roomCode, this.secret);
    } catch {
      this.emitError();
      this.close();
      return;
    }
    if (this.closed) return;
    this.topicHash = keys.topicHash;

    const brokers = this.opts.brokers ?? DEFAULT_MQTT_BROKERS;
    const wsFactory = this.opts.wsFactory ?? defaultWsFactory;
    const timeoutMs = this.opts.brokerAttemptTimeoutMs ?? 3000;

    for (let i = 0; i < brokers.length; i++) {
      if (this.closed || this.open) return;
      const url = brokers[i];
      const ok = await this.tryBroker(url, keys.topicHash, keys.roomAuthKey, wsFactory, timeoutMs);
      if (ok || this.closed) return;
    }

    if (!this.closed && !this.open) {
      this.emitError();
      this.close();
    }
  }

  private async tryBroker(
    url: string,
    topicHash: string,
    roomAuthKey: CryptoKey,
    wsFactory: WebSocketFactory,
    timeoutMs: number,
  ): Promise<boolean> {
    const clientKp = await generateEphemeralKeyPair();
    const clientNonce = randomHex(12);
    const downTopic = `mfo/v2/${topicHash}/c/${this.clientId}`;
    const upTopic = `mfo/v2/${topicHash}/h/${this.clientId}`;
    const joinTopic = `mfo/v2/${topicHash}/join`;

    const willBye: HandshakeBye = {
      t: 'bye',
      clientId: this.clientId,
      clientNonce,
      ts: Date.now(),
    };
    const willPayload = encoder.encode(await encryptHandshake(roomAuthKey, topicHash, willBye));

    return new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (result: boolean) => {
        if (settled) return;
        settled = true;
        if (this.attemptTimer) clearTimeout(this.attemptTimer);
        this.attemptTimer = null;
        resolve(result);
      };

      this.attemptTimer = setTimeout(() => {
        if (!this.open) {
          sock.close();
          finish(false);
        }
      }, timeoutMs);

      const sock = new MqttBrokerSocket(
        url,
        `mfo-c-${this.clientId}`,
        [downTopic],
        (topic, payload) => {
          if (topic !== downTopic || this.closed) return;
          void this.handleDownstream(
            payload,
            topicHash,
            roomAuthKey,
            clientKp.privateKey,
            clientNonce,
            upTopic,
            finish,
          );
        },
        (connected) => {
          if (this.closed) return;
          if (connected) {
            void (async () => {
              const syn: HandshakeSyn = {
                t: 'syn',
                clientId: this.clientId,
                clientPub: clientKp.publicKeyB64,
                clientNonce,
                ts: Date.now(),
              };
              const encSyn = await encryptHandshake(roomAuthKey, topicHash, syn);
              sock.publish(joinTopic, encSyn);
            })();
          } else if (settled && this.sock === sock) {
            this.close();
          } else if (!settled) {
            sock.close();
            finish(false);
          }
        },
        wsFactory,
        { topic: upTopic, payload: willPayload },
      );

      this.sock = sock;
    });
  }

  private async handleDownstream(
    payload: string,
    topicHash: string,
    roomAuthKey: CryptoKey,
    clientPrivateKey: CryptoKey,
    expectedNonce: string,
    upTopic: string,
    finishHandshake: (ok: boolean) => void,
  ) {
    if (!this.link) {
      const ack = await decryptHandshake<HandshakeSynAck>(roomAuthKey, topicHash, 'syn-ack', payload);
      if (
        !ack ||
        ack.clientId !== this.clientId ||
        ack.clientNonce !== expectedNonce ||
        !ack.hostPub ||
        !ack.sessionId ||
        !ack.hostNonce
      ) {
        return;
      }

      let sessionKey: CryptoKey;
      try {
        sessionKey = await deriveSessionKey(
          clientPrivateKey,
          ack.hostPub,
          this.roomCode.trim().toUpperCase(),
          this.clientId,
          ack.sessionId,
          expectedNonce,
          ack.hostNonce,
        );
      } catch {
        return;
      }
      if (this.closed || this.link) return;

      const session = new EncryptedSession(ack.sessionId, sessionKey, 'c2h', 'h2c');
      // Hold on to this socket: frames are sealed asynchronously, and the final "bye" must still
      // go out after close() has let go of this.sock.
      const sock = this.sock;
      this.link = new ReliableLink(
        session,
        (wire) => sock?.publish(upTopic, wire),
        {
          onData: (d) => this.emitData(d),
          onControl: (frame) => {
            if (frame.k === 'bye') this.close();
          },
          onBroken: () => this.close(),
        },
        this.opts.link,
      );
      this.open = true;
      this.lastHostSeen = Date.now();
      this.startHeartbeats(upTopic);
      finishHandshake(true);
      this.emitOpen();
      return;
    }

    if (await this.link.receive(payload)) this.lastHostSeen = Date.now();
  }

  private startHeartbeats(upTopic: string) {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    const intervalMs = this.opts.heartbeatIntervalMs ?? 5000;
    const timeoutMs = this.opts.heartbeatTimeoutMs ?? 16_000;
    this.heartbeatTimer = setInterval(() => {
      if (!this.open || !this.link) return;
      if (Date.now() - this.lastHostSeen > timeoutMs) {
        this.close();
        return;
      }
      this.link.control({ k: 'ping' });
    }, intervalMs);
    void upTopic;
  }

  send(data: unknown) {
    if (this.open) this.link?.send(data);
  }

  close() {
    if (this.closed) return;
    const wasOpen = this.open;
    this.closed = true;
    this.open = false;
    if (this.attemptTimer) clearTimeout(this.attemptTimer);
    this.attemptTimer = null;
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;

    const link = this.link;
    const sock = this.sock;
    if (wasOpen && link && sock?.isConnected) {
      // Tell the host we're leaving, then hang up.
      void link.closeWith({ k: 'bye' }).finally(() => sock.close());
    } else {
      link?.close();
      sock?.close();
    }
    this.sock = null;
    if (wasOpen) this.emitClose();
  }
}
