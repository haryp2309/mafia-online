import Peer from 'peerjs';
import { useSyncExternalStore } from 'react';
import { GameError } from '../../../shared/game';
import { HostController } from '../../../shared/host';
import { newRoomCode, PEER_PREFIX, type HostEvent } from '../../../shared/protocol';
import type { ClientState, Game } from '../../../shared/types';
import { iceServers, usesRelay } from './ice';
import { isValidRoomSecret, newRoomSecret } from './mqttCrypto';
import { MqttHostServer, type PeerConnectionLike } from './mqttTransport';
import { setSendHandler } from './send';

/**
 * The host browser is the game's home: it keeps the game in localStorage, opens a PeerJS
 * "room" that phones connect to, and runs the HostController.
 */
const STORE_KEY = 'mafia-host-v1';

export type HostStatus = 'starting' | 'online' | 'reconnecting' | 'taken' | 'offline';

interface Stored {
  roomCode: string;
  /** Random secret for the encrypted relay; travels to phones only inside the QR link. */
  roomSecret: string;
  game: Game | null;
}

function load(): Stored {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const stored = JSON.parse(raw) as Stored;
      // Saves from before the room secret existed get one now.
      if (!isValidRoomSecret(stored.roomSecret)) stored.roomSecret = newRoomSecret();
      return stored;
    }
  } catch {
    // Unreadable or blocked storage: start fresh.
  }
  return { roomCode: newRoomCode(), roomSecret: newRoomSecret(), game: null };
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
function persist(stored: Stored) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(stored));
    } catch {
      // Private mode or full storage: the game still works, it just won't survive a reload.
    }
  }, 150);
}

interface Snapshot {
  state: ClientState;
  status: HostStatus;
  roomCode: string;
  roomSecret: string;
  error: string | null;
  /** A phone runs a newer version of the app than this host page. */
  newerVersion: boolean;
}

class HostRuntime {
  private stored = load();
  readonly controller: HostController;
  private peer: Peer | null = null;
  private mqtt: MqttHostServer | null = null;
  private listeners = new Set<() => void>();
  private snapshot: Snapshot;
  private retry: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.controller = new HostController(
      this.stored.game,
      (game) => {
        this.stored.game = game;
        persist(this.stored);
      },
      __BUILD__,
    );
    this.stored.game = this.controller.game;
    persist(this.stored);
    this.snapshot = {
      state: this.controller.view(),
      status: 'starting',
      roomCode: this.stored.roomCode,
      roomSecret: this.stored.roomSecret,
      error: null,
      newerVersion: false,
    };
    this.controller.subscribe(() => this.update({ state: this.controller.view() }));
    setSendHandler((event, args) => this.act(event as HostEvent, args));
    window.addEventListener('pagehide', () => {
      this.peer?.destroy();
      this.mqtt?.destroy();
    });
    this.mqtt = new MqttHostServer(this.stored.roomCode, this.stored.roomSecret, {
      onConnection: (conn) => this.accept(conn),
      onStatusChange: (online) => {
        if (online && (this.snapshot.status === 'starting' || this.snapshot.status === 'offline')) {
          this.update({ status: 'online' });
        }
      },
    });
    void this.open();
  }

  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  getSnapshot = () => this.snapshot;

  clearError = () => this.update({ error: null });

  private update(patch: Partial<Snapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const l of this.listeners) l();
  }

  private act(event: HostEvent, args: unknown[]) {
    try {
      this.controller.hostAction(event, ...args);
    } catch (err) {
      if (!(err instanceof GameError)) console.error(err);
      this.update({ error: err instanceof Error ? err.message : String(err) });
    }
  }

  private async open() {
    if (this.retry) clearTimeout(this.retry);
    this.peer?.destroy();
    const peer = new Peer(PEER_PREFIX + this.stored.roomCode, { config: { iceServers: await iceServers() } });
    this.peer = peer;

    peer.on('open', () => this.update({ status: 'online' }));
    peer.on('connection', (conn) => this.accept(conn));
    peer.on('disconnected', () => {
      // Lost the matchmaking server; phones already connected keep playing meanwhile.
      if (peer.destroyed) return;
      this.update({ status: 'reconnecting' });
      setTimeout(() => !peer.destroyed && peer.reconnect(), 1500);
    });
    peer.on('error', (err) => {
      if (peer !== this.peer) return;
      // The room id can stay reserved for a few seconds after a reload, or another tab holds it.
      if (err.type === 'unavailable-id') {
        this.update({ status: 'taken' });
      } else if (!this.mqtt?.isOnline) {
        this.update({ status: 'offline' });
      }
      if (['unavailable-id', 'network', 'server-error', 'socket-error', 'socket-closed'].includes(err.type)) {
        this.retry = setTimeout(() => void this.open(), 4000);
      }
    });
  }

  private accept(conn: PeerConnectionLike) {
    const id = conn.connectionId;
    conn.on('open', () => {
      this.controller.connect({ id, send: (msg) => conn.open && conn.send(msg), relayed: !!conn.relayed });
      // A direct WebRTC link may still be going through a TURN relay; check once it settles.
      const pc = (conn as { peerConnection?: RTCPeerConnection }).peerConnection;
      if (!conn.relayed && pc) {
        setTimeout(async () => {
          if (conn.open && (await usesRelay(pc))) this.controller.setRelayed(id, true);
        }, 1500);
      }
    });
    conn.on('data', (data) => {
      const msg = data as { t?: string; build?: string };
      if (msg?.t === 'hello' && msg.build && Number(msg.build) > Number(__BUILD__)) this.update({ newerVersion: true });
      this.controller.receive(id, data);
    });
    const gone = () => this.controller.disconnect(id);
    conn.on('close', gone);
    conn.on('error', gone);
  }

  /** Start over in a brand-new room (new code). The current game setup is kept. */
  newRoom() {
    this.stored.roomCode = newRoomCode();
    this.stored.roomSecret = newRoomSecret();
    persist(this.stored);
    this.update({ roomCode: this.stored.roomCode, roomSecret: this.stored.roomSecret, status: 'starting' });
    this.mqtt?.setRoom(this.stored.roomCode, this.stored.roomSecret);
    void this.open();
  }
}

let runtime: HostRuntime | null = null;

export function hostRuntime(): HostRuntime {
  runtime ??= new HostRuntime();
  return runtime;
}

export function useHost() {
  const rt = hostRuntime();
  const snap = useSyncExternalStore(rt.subscribe, rt.getSnapshot);
  return { ...snap, clearError: rt.clearError, newRoom: () => rt.newRoom() };
}
