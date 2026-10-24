import Peer, { type DataConnection } from 'peerjs';
import { useSyncExternalStore } from 'react';
import { PEER_PREFIX, type ClientMessage, type HostMessage } from '../../../shared/protocol';
import type { ClientState } from '../../../shared/types';
import { iceServers, usesRelay } from './ice';
import { setClockOffset, setSendHandler } from './send';

/**
 * A phone's link to the host browser. Reconnects by itself (the host may reload, a phone may
 * sleep) and re-identifies with the seat token it saved when claiming a name.
 */
export type PlayerStatus = 'connecting' | 'connected' | 'host-offline' | 'reconnecting';

interface Snapshot {
  state: ClientState | null;
  status: PlayerStatus;
  error: string | null;
  /** The connection goes through a third-party relay server instead of directly. */
  relayed: boolean;
}

const tokenKey = (room: string) => `mafia-token-${room}`;

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

class PlayerRuntime {
  private peer: Peer | null = null;
  private conn: DataConnection | null = null;
  private listeners = new Set<() => void>();
  private snapshot: Snapshot = { state: null, status: 'connecting', error: null, relayed: false };
  private retry: ReturnType<typeof setTimeout> | null = null;
  private attempts = 0;

  constructor(readonly room: string) {
    setSendHandler((event, args) => this.send({ t: 'act', event: event as never, args }));
    window.addEventListener('pagehide', () => this.peer?.destroy());
    // Phones drop connections when the screen locks; reconnect as soon as it's back.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && !this.conn?.open) this.scheduleConnect(0);
    });
    void this.start();
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
    if (this.conn?.open) this.conn.send(msg);
    else this.update({ error: 'Not connected to the host yet. Hang on…' });
  }

  private async start() {
    this.peer?.destroy();
    const peer = new Peer({ config: { iceServers: await iceServers() } });
    this.peer = peer;
    peer.on('open', () => this.connect());
    peer.on('disconnected', () => !peer.destroyed && setTimeout(() => !peer.destroyed && peer.reconnect(), 1500));
    peer.on('error', (err) => {
      if (peer !== this.peer) return;
      if (err.type === 'peer-unavailable') {
        // The host page isn't open (or is reloading). Keep knocking.
        this.update({ status: 'host-offline' });
        this.scheduleConnect(3000);
      } else if (['network', 'server-error', 'socket-error', 'socket-closed', 'browser-incompatible'].includes(err.type)) {
        this.update({ status: 'reconnecting' });
        if (this.retry) clearTimeout(this.retry);
        this.retry = setTimeout(() => void this.start(), 3000);
      }
    });
  }

  private scheduleConnect(delay: number) {
    if (this.retry) clearTimeout(this.retry);
    this.retry = setTimeout(() => {
      if (this.peer && !this.peer.destroyed && this.peer.open) this.connect();
      else void this.start();
    }, delay);
  }

  private connect() {
    if (this.conn?.open) return;
    this.conn?.close();
    const conn = this.peer!.connect(PEER_PREFIX + this.room, { reliable: true });
    this.conn = conn;
    this.attempts++;
    // A connection that never opens (blocked network) is retried, a little slower each time.
    const timeout = setTimeout(() => {
      if (!conn.open && conn === this.conn) {
        conn.close();
        this.update({ status: 'reconnecting' });
        this.scheduleConnect(Math.min(8000, 1000 * this.attempts));
      }
    }, 12000);

    conn.on('open', () => {
      clearTimeout(timeout);
      this.attempts = 0;
      this.update({ status: 'connected', error: null });
      conn.send({ t: 'hello', build: __BUILD__, token: readToken(this.room) } satisfies ClientMessage);
      // Give ICE a moment to settle on its final route before checking for a relay.
      setTimeout(async () => this.update({ relayed: await usesRelay(conn.peerConnection) }), 1500);
    });
    conn.on('data', (data) => this.receive(data as HostMessage));
    conn.on('close', () => {
      if (conn !== this.conn) return;
      this.update({ status: 'reconnecting' });
      this.scheduleConnect(1500);
    });
    conn.on('error', () => conn === this.conn && this.scheduleConnect(2000));
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
