import Peer, { type DataConnection } from 'peerjs';
import { useSyncExternalStore } from 'react';
import { PEER_PREFIX, type ClientMessage, type HostMessage } from '../../../shared/protocol';
import type { ClientState } from '../../../shared/types';
import { iceServers, usesRelay } from './ice';
import { isValidRoomSecret } from './mqttCrypto';
import { MqttClientConnection, type PeerConnectionLike } from './mqttTransport';
import { setClockOffset, setSendHandler } from './send';

/**
 * A phone's link to the host browser. Reconnects by itself (the host may reload, a phone may
 * sleep) and re-identifies with the seat token it saved when claiming a name.
 *
 * Direct WebRTC (PeerJS) is always preferred. If it hasn't opened after a head start, the
 * encrypted public relay (MQTT over wss://) is tried in parallel and whichever opens first is
 * used. While on the relay, direct is retried now and then and taken over as soon as it works.
 * The relay needs the room secret from the QR link; without it the player is asked to scan.
 * `?relay` in the address forces the relay (for testing, or for networks that need it).
 */
export type PlayerStatus = 'connecting' | 'connected' | 'host-offline' | 'reconnecting';
export type RelayMode = null | 'turn' | 'mqtt';

/** How long direct WebRTC gets on its own before the relay starts racing it. */
const RELAY_HEAD_START_MS = 5000;
/** How long a direct attempt may take before it's abandoned. */
const DIRECT_TIMEOUT_MS = 15000;
/** While on the relay, how often to try upgrading to a direct connection. */
const UPGRADE_EVERY_MS = 30000;

interface Snapshot {
  state: ClientState | null;
  status: PlayerStatus;
  error: string | null;
  /** The connection goes through a third-party relay (TURN or the public MQTT relay). */
  relayed: boolean;
  relayMode: RelayMode;
  /** The relay is needed but this phone has no room secret: ask to join via the QR code. */
  needsQr: boolean;
  /** `?relay` was given: never try a direct connection. */
  forcedRelay: boolean;
}

const tokenKey = (room: string) => `mafia-token-${room}`;
const secretKey = (room: string) => `mafia-secret-${room}`;

function readToken(room: string): string | null {
  try {
    return localStorage.getItem(tokenKey(room));
  } catch {
    return null;
  }
}

function writeToken(room: string, token: string | null) {
  try {
    if (token) localStorage.setItem(tokenKey(room), token);
    else localStorage.removeItem(tokenKey(room));
  } catch {
    // Private mode: the player just has to pick their name again after a reload.
  }
}

/** The relay secret from the QR link's #k=… fragment, remembered for this room. */
function readSecret(room: string): string | null {
  const fromLink = new URLSearchParams(window.location.hash.slice(1)).get('k');
  try {
    if (isValidRoomSecret(fromLink)) {
      localStorage.setItem(secretKey(room), fromLink);
      return fromLink;
    }
    const saved = localStorage.getItem(secretKey(room));
    return isValidRoomSecret(saved) ? saved : null;
  } catch {
    return isValidRoomSecret(fromLink) ? fromLink : null;
  }
}

function relayForced(): boolean {
  const value = new URLSearchParams(window.location.search).get('relay');
  return value !== null && value !== '0' && value !== 'false' && value !== 'off';
}

/** Reload once if the host runs a newer version of the app than this page. */
function reloadIfOutdated(hostBuild: string) {
  if (!(Number(hostBuild) > Number(__BUILD__))) return false;
  try {
    if (sessionStorage.getItem('mafia-reloaded-for') === hostBuild) return false;
    sessionStorage.setItem('mafia-reloaded-for', hostBuild);
  } catch {
    return false;
  }
  window.location.reload();
  return true;
}

type Link = DataConnection | PeerConnectionLike;

class PlayerRuntime {
  private peer: Peer | null = null;
  /** The connection in use; at most one direct and one relay attempt race alongside it. */
  private active: Link | null = null;
  private direct: DataConnection | null = null;
  private relay: MqttClientConnection | null = null;
  private readonly secret: string | null;
  private readonly forceRelay: boolean;
  private listeners = new Set<() => void>();
  private snapshot: Snapshot;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private headStart: ReturnType<typeof setTimeout> | null = null;
  private upgradeTimer: ReturnType<typeof setInterval> | null = null;
  private attempts = 0;

  constructor(readonly room: string) {
    this.secret = readSecret(room);
    this.forceRelay = relayForced();
    this.snapshot = {
      state: null,
      status: 'connecting',
      error: null,
      relayed: false,
      relayMode: null,
      needsQr: this.forceRelay && !this.secret,
      forcedRelay: this.forceRelay,
    };
    setSendHandler((event, args) => this.send({ t: 'act', event: event as never, args }));
    window.addEventListener('pagehide', () => {
      this.active?.close();
      this.relay?.close();
      this.peer?.destroy();
    });
    // Phones drop connections when the screen locks; reconnect as soon as it's back.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && !this.active?.open) this.reconnectSoon(0);
    });
    if (this.forceRelay) this.tryRelay();
    else void this.startPeer();
  }

  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  getSnapshot = () => this.snapshot;

  clearError = () => this.update({ error: null });

  leave() {
    writeToken(this.room, null);
    this.send({ t: 'act', event: 'player:leave', args: [] });
  }

  private update(patch: Partial<Snapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const l of this.listeners) l();
  }

  private send(msg: ClientMessage) {
    if (this.active?.open) this.active.send(msg);
    else this.update({ error: 'Not connected to the host yet. Hang on…' });
  }

  // ---------- direct (WebRTC via PeerJS) ----------

  private async startPeer() {
    this.peer?.destroy();
    const peer = new Peer({ config: { iceServers: await iceServers() } });
    this.peer = peer;
    peer.on('open', () => this.tryDirect());
    peer.on('disconnected', () => !peer.destroyed && setTimeout(() => !peer.destroyed && peer.reconnect(), 1500));
    peer.on('error', (err) => {
      if (peer !== this.peer) return;
      if (err.type === 'peer-unavailable') {
        // The matchmaker doesn't see the host. It may still be reachable through the relay.
        this.direct?.close();
        this.direct = null;
        if (!this.active?.open && !this.secret) this.update({ status: this.snapshot.state ? 'reconnecting' : 'host-offline' });
        this.directFailed();
      } else if (['network', 'server-error', 'socket-error', 'socket-closed', 'browser-incompatible', 'webrtc'].includes(err.type)) {
        // Can't even reach the matchmaker: direct is out for now.
        this.directFailed();
        setTimeout(() => peer === this.peer && !this.active?.open && void this.startPeer(), 8000);
      }
    });
  }

  private tryDirect() {
    if (this.forceRelay || !this.peer?.open || this.direct) return;
    if (this.active && this.active === this.direct) return;
    const conn = this.peer.connect(PEER_PREFIX + this.room, { reliable: true });
    this.direct = conn;
    this.attempts++;
    // Give direct a head start, then let the relay race it.
    if (this.headStart) clearTimeout(this.headStart);
    if (!this.active?.open) this.headStart = setTimeout(() => !this.active?.open && this.tryRelay(), RELAY_HEAD_START_MS);
    const timeout = setTimeout(() => {
      if (!conn.open && conn === this.direct) {
        conn.close();
        this.direct = null;
        this.directFailed();
      }
    }, DIRECT_TIMEOUT_MS);

    conn.on('open', () => {
      clearTimeout(timeout);
      if (conn !== this.direct) return conn.close();
      this.adopt(conn, null);
      // Give ICE a moment to settle on its final route before checking for a TURN relay.
      setTimeout(async () => {
        if (conn !== this.active || !conn.open) return;
        const turn = await usesRelay(conn.peerConnection);
        this.update({ relayed: turn, relayMode: turn ? 'turn' : null });
      }, 1500);
    });
    conn.on('data', (data) => conn === this.active && this.receive(data as HostMessage));
    conn.on('close', () => {
      clearTimeout(timeout);
      if (conn === this.direct) this.direct = null;
      if (conn === this.active) this.lost();
    });
    conn.on('error', () => {
      clearTimeout(timeout);
      if (conn === this.direct && !conn.open) {
        this.direct = null;
        this.directFailed();
      }
    });
  }

  /** Direct didn't work this time: race the relay now, or ask for the QR code if we can't. */
  private directFailed() {
    if (this.active?.open) return;
    if (this.secret) {
      this.tryRelay();
    } else {
      this.update({ needsQr: true });
      this.reconnectSoon(Math.min(8000, 2000 * Math.max(1, this.attempts)));
    }
  }

  // ---------- relay (encrypted MQTT) ----------

  private tryRelay() {
    if (this.relay || (this.active && this.active === this.relay)) return;
    if (!this.secret) {
      this.update({ needsQr: true });
      return;
    }
    const conn = new MqttClientConnection(this.room, this.secret);
    this.relay = conn;
    conn.on('open', () => {
      if (conn !== this.relay) return conn.close();
      // Direct won the race meanwhile: keep it, drop the relay.
      if (this.active?.open && this.active !== conn) {
        this.relay = null;
        return conn.close();
      }
      this.adopt(conn, 'mqtt');
    });
    conn.on('data', (data) => conn === this.active && this.receive(data as HostMessage));
    const gone = () => {
      if (conn === this.relay) this.relay = null;
      if (conn === this.active) this.lost();
      else if (!this.active?.open) this.reconnectSoon(3000);
    };
    conn.on('close', gone);
    conn.on('error', gone);
  }

  // ---------- switching ----------

  /** Makes `conn` the connection in use and introduces this phone to the host on it. */
  private adopt(conn: Link, relayMode: RelayMode) {
    const previous = this.active;
    this.active = conn;
    if (this.headStart) clearTimeout(this.headStart);
    this.attempts = 0;
    this.update({ status: 'connected', error: null, relayed: relayMode !== null, relayMode, needsQr: false });
    conn.send({ t: 'hello', build: __BUILD__, token: readToken(this.room) } satisfies ClientMessage);

    if (previous && previous !== conn) {
      // Upgraded (relay → direct): retire the old link.
      if (previous === this.relay) this.relay = null;
      if (previous === this.direct) this.direct = null;
      previous.close();
    }
    // If the relay won, a still-pending direct attempt keeps going and takes over if it opens.

    if (this.upgradeTimer) clearInterval(this.upgradeTimer);
    this.upgradeTimer = null;
    if (relayMode === 'mqtt' && !this.forceRelay) {
      this.upgradeTimer = setInterval(() => {
        if (this.active === this.relay && this.peer?.open && !this.direct) this.tryDirect();
      }, UPGRADE_EVERY_MS);
    }
  }

  private lost() {
    this.active = null;
    if (this.upgradeTimer) clearInterval(this.upgradeTimer);
    this.upgradeTimer = null;
    this.update({ status: 'reconnecting' });
    this.reconnectSoon(1500);
  }

  private reconnectSoon(delay: number) {
    if (this.retry) clearTimeout(this.retry);
    this.retry = setTimeout(() => {
      if (this.active?.open) return;
      if (this.forceRelay) return this.tryRelay();
      if (this.peer && !this.peer.destroyed && this.peer.open) this.tryDirect();
      else void this.startPeer();
    }, delay);
  }

  private receive(msg: HostMessage) {
    switch (msg.t) {
      case 'state':
        if (reloadIfOutdated(msg.build)) return;
        setClockOffset(msg.state.public.serverNow - Date.now());
        this.update({ state: msg.state });
        break;
      case 'token':
        writeToken(this.room, msg.token);
        break;
      case 'token-invalid':
        writeToken(this.room, null);
        break;
      case 'error':
        this.update({ error: msg.message });
        break;
    }
  }
}

let runtime: PlayerRuntime | null = null;

export function playerRuntime(room: string): PlayerRuntime {
  runtime ??= new PlayerRuntime(room);
  return runtime;
}

export function usePlayer(room: string) {
  const rt = playerRuntime(room);
  const snap = useSyncExternalStore(rt.subscribe, rt.getSnapshot);
  return { ...snap, clearError: rt.clearError, leave: () => rt.leave() };
}
