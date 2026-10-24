/**
 * End-to-End Encryption (E2EE), authenticated framing, replay protection, and topic obfuscation
 * for the public MQTT fallback transport.
 *
 * Security model:
 * 1. Room secret: the host creates a random 256-bit secret per room. It reaches phones only
 *    through the QR code link (in the #fragment, which browsers never send to any server).
 *    A 128-bit `topicHash` and a 256-bit `roomAuthKey` are derived from it with HKDF-SHA256,
 *    so knowing (or guessing) the 5-letter room code is not enough to find or join the relay.
 * 2. Authenticated Ephemeral ECDH (P-256) Handshake:
 *    - Client generates an ephemeral P-256 keypair + random nonce, encrypted with `roomAuthKey` (AES-256-GCM).
 *    - Host verifies the handshake, checks timestamp/nonce freshness (preventing handshake replay),
 *      generates its own ephemeral P-256 keypair + nonce + random `sessionId`, and replies encrypted with `roomAuthKey`.
 *    - Both sides derive a forward-secret per-connection 256-bit AES-GCM `sessionKey` via HKDF-SHA256.
 * 3. AEAD Framing & Replay Protection:
 *    - Every session frame is encrypted with AES-256-GCM using a unique 96-bit IV.
 *    - Additional Authenticated Data (AAD) binds `{ sessionId, dir ('c2h' | 'h2c'), seq }`.
 *    - `seq` is strictly monotonic (1, 2, 3...). Any packet with `seq <= lastSeenSeq` or invalid tag is dropped.
 */

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const HKDF_SALT = encoder.encode('mafia-online-mqtt-e2ee-v2');
const HANDSHAKE_TTL_MS = 120_000; // 2 minutes clock skew tolerance for handshake

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

export function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** URL-safe base64 without padding, for putting the room secret in a link. */
export function toBase64Url(bytes: Uint8Array): string {
  return toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(text: string): Uint8Array {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
  return fromBase64(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
}

/** A new random 256-bit room secret, as a URL-safe string (43 characters). */
export function newRoomSecret(): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

/** True if `text` decodes to a secret of at least 128 bits. */
export function isValidRoomSecret(text: string | null | undefined): text is string {
  if (!text || !/^[A-Za-z0-9_-]{22,}$/.test(text)) return false;
  try {
    return fromBase64Url(text).length >= 16;
  } catch {
    return false;
  }
}

export function randomHex(byteLength = 12): string {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  return toHex(bytes);
}

export interface RoomKeys {
  roomCode: string;
  topicHash: string;
  roomAuthKey: CryptoKey;
}

const roomKeysCache = new Map<string, Promise<RoomKeys>>();

/**
 * Derives the hidden topic namespace (`topicHash`) and the handshake key (`roomAuthKey`) from
 * the host's random room secret. The room code is mixed in so one secret can't serve two rooms.
 */
export function deriveRoomKeys(roomCode: string, secret: string): Promise<RoomKeys> {
  const norm = roomCode.trim().toUpperCase();
  if (!isValidRoomSecret(secret)) return Promise.reject(new Error('Missing or invalid room secret.'));
  const cacheKey = `${norm}|${secret}`;
  const cached = roomKeysCache.get(cacheKey);
  if (cached) return cached;

  const promise = (async () => {
    const baseKey = await crypto.subtle.importKey('raw', fromBase64Url(secret) as BufferSource, 'HKDF', false, [
      'deriveBits',
    ]);
    const bits = await crypto.subtle.deriveBits(
      { name: 'HKDF', hash: 'SHA-256', salt: HKDF_SALT, info: encoder.encode(`mafia-room|${norm}`) },
      baseKey,
      384, // first 128 bits = topicHash, remaining 256 bits = roomAuthKey
    );
    const all = new Uint8Array(bits);
    const topicHash = toHex(all.subarray(0, 16));
    const keyBytes = all.subarray(16, 48);
    const roomAuthKey = await crypto.subtle.importKey(
      'raw',
      keyBytes,
      { name: 'AES-GCM' },
      false,
      ['encrypt', 'decrypt'],
    );
    return { roomCode: norm, topicHash, roomAuthKey };
  })();

  roomKeysCache.set(cacheKey, promise);
  return promise;
}

export interface EphemeralKeyPair {
  privateKey: CryptoKey;
  publicKeyB64: string;
}

export async function generateEphemeralKeyPair(): Promise<EphemeralKeyPair> {
  const kp = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    ['deriveBits'],
  );
  const rawPub = await crypto.subtle.exportKey('raw', kp.publicKey);
  return {
    privateKey: kp.privateKey,
    publicKeyB64: toBase64(new Uint8Array(rawPub)),
  };
}

export async function deriveSessionKey(
  myPrivateKey: CryptoKey,
  peerPublicKeyB64: string,
  roomCode: string,
  clientId: string,
  sessionId: string,
  clientNonce: string,
  hostNonce: string,
): Promise<CryptoKey> {
  const rawPeer = fromBase64(peerPublicKeyB64);
  const peerPub = await crypto.subtle.importKey(
    'raw',
    rawPeer as BufferSource,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );
  const sharedBits = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: peerPub },
    myPrivateKey,
    256,
  );
  const hkdfBase = await crypto.subtle.importKey('raw', sharedBits, 'HKDF', false, ['deriveKey']);
  const info = encoder.encode(`mfo-session|${roomCode}|${clientId}|${sessionId}|${clientNonce}|${hostNonce}`);
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: HKDF_SALT,
      info,
    },
    hkdfBase,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

// ---------- Handshake packets (encrypted with roomAuthKey) ----------

export interface HandshakeSyn {
  t: 'syn';
  clientId: string;
  clientPub: string;
  clientNonce: string;
  ts: number;
}

export interface HandshakeSynAck {
  t: 'syn-ack';
  clientId: string;
  sessionId: string;
  hostPub: string;
  clientNonce: string;
  hostNonce: string;
}

export interface HandshakeBye {
  t: 'bye';
  clientId: string;
  clientNonce: string;
  ts: number;
}

export interface WireEnvelope {
  v: 1;
  iv: string;
  ct: string;
  /** Present on session frames (bound into AAD). */
  sid?: string;
  seq?: number;
}

export async function encryptHandshake(
  roomAuthKey: CryptoKey,
  topicHash: string,
  payload: HandshakeSyn | HandshakeSynAck | HandshakeBye,
): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const aad = encoder.encode(`mfo-hs|${topicHash}|${payload.t}`);
  const pt = encoder.encode(JSON.stringify(payload));
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: aad },
    roomAuthKey,
    pt,
  );
  const env: WireEnvelope = { v: 1, iv: toBase64(iv), ct: toBase64(new Uint8Array(ct)) };
  return JSON.stringify(env);
}

export async function decryptHandshake<T extends HandshakeSyn | HandshakeSynAck | HandshakeBye>(
  roomAuthKey: CryptoKey,
  topicHash: string,
  expectedType: T['t'],
  rawText: string,
): Promise<T | null> {
  try {
    const env = JSON.parse(rawText) as WireEnvelope;
    if (env?.v !== 1 || typeof env.iv !== 'string' || typeof env.ct !== 'string') return null;
    const iv = fromBase64(env.iv);
    if (iv.length !== 12) return null;
    const aad = encoder.encode(`mfo-hs|${topicHash}|${expectedType}`);
    const pt = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv as BufferSource, additionalData: aad },
      roomAuthKey,
      fromBase64(env.ct) as BufferSource,
    );
    const parsed = JSON.parse(decoder.decode(pt)) as T;
    if (parsed.t !== expectedType) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Tracks seen client handshake nonces on the Host to prevent handshake replay attacks.
 */
export class HandshakeReplayGuard {
  private seen = new Map<string, number>();

  checkAndRecord(syn: HandshakeSyn, now = Date.now()): boolean {
    if (Math.abs(now - syn.ts) > HANDSHAKE_TTL_MS) return false;
    // Prune expired nonces
    for (const [nonce, ts] of this.seen) {
      if (now - ts > HANDSHAKE_TTL_MS * 2) this.seen.delete(nonce);
    }
    if (this.seen.has(syn.clientNonce)) return false;
    this.seen.set(syn.clientNonce, now);
    return true;
  }
}

// ---------- Session AEAD channel ----------

export type Direction = 'c2h' | 'h2c';

/** Small unreliable control messages; replays are rejected by their own counter. */
export type ControlFrame = { k: 'ack'; upTo: number } | { k: 'ping' } | { k: 'pong' } | { k: 'bye' };

export type Opened = { ch: 'd'; seq: number; data: unknown } | { ch: 'c'; frame: ControlFrame };

interface SessionEnvelope {
  v: 2;
  sid: string;
  ch: 'd' | 'c';
  seq: number;
  iv: string;
  ct: string;
}

/**
 * Encrypts and authenticates frames for one connection. Data frames carry the reliable
 * layer's sequence number (ordering and duplicates are handled there, see mqttReliable.ts);
 * control frames have their own strictly increasing counter. The session id, direction,
 * channel and sequence number are all bound into the AES-GCM additional data, so a frame
 * can't be replayed in another session, reflected back, or moved to another position.
 */
export class EncryptedSession {
  private ctrlTxSeq = 0;
  private ctrlRxHighest = 0;

  constructor(
    readonly sessionId: string,
    private readonly key: CryptoKey,
    private readonly txDir: Direction,
    private readonly rxDir: Direction,
  ) {}

  private aad(dir: Direction, ch: 'd' | 'c', seq: number) {
    return encoder.encode(`mfo-frame|${this.sessionId}|${dir}|${ch}|${seq}`);
  }

  private async seal(ch: 'd' | 'c', seq: number, body: unknown): Promise<string> {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: this.aad(this.txDir, ch, seq) },
      this.key,
      encoder.encode(JSON.stringify(body)),
    );
    const env: SessionEnvelope = { v: 2, sid: this.sessionId, ch, seq, iv: toBase64(iv), ct: toBase64(new Uint8Array(ct)) };
    return JSON.stringify(env);
  }

  sealData(seq: number, data: unknown): Promise<string> {
    return this.seal('d', seq, data);
  }

  sealControl(frame: ControlFrame): Promise<string> {
    return this.seal('c', ++this.ctrlTxSeq, frame);
  }

  async open(rawText: string): Promise<Opened | null> {
    try {
      const env = JSON.parse(rawText) as SessionEnvelope;
      if (
        env?.v !== 2 ||
        env.sid !== this.sessionId ||
        (env.ch !== 'd' && env.ch !== 'c') ||
        !Number.isInteger(env.seq) ||
        env.seq < 1 ||
        typeof env.iv !== 'string' ||
        typeof env.ct !== 'string'
      ) {
        return null;
      }
      if (env.ch === 'c' && env.seq <= this.ctrlRxHighest) return null;
      const iv = fromBase64(env.iv);
      if (iv.length !== 12) return null;
      const pt = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: iv as BufferSource, additionalData: this.aad(this.rxDir, env.ch, env.seq) },
        this.key,
        fromBase64(env.ct) as BufferSource,
      );
      const body = JSON.parse(decoder.decode(pt)) as unknown;
      if (env.ch === 'd') return { ch: 'd', seq: env.seq, data: body };
      const frame = body as ControlFrame;
      if (!frame || typeof frame.k !== 'string') return null;
      // Only advance after the tag verified, and re-check: decrypts can finish out of order.
      if (env.seq <= this.ctrlRxHighest) return null;
      this.ctrlRxHighest = env.seq;
      return { ch: 'c', frame };
    } catch {
      return null;
    }
  }
}
