import * as engine from './game';
import type { ClientMessage, HostEvent, HostMessage } from './protocol';
import { PLAYER_EVENTS } from './protocol';
import type { Ballot, ClientState, Game } from './types';
import { clientView } from './views';

/** One phone's connection, whatever carries it (WebRTC in the app, fakes in tests). */
export interface Connection {
  id: string;
  send(msg: HostMessage): void;
}

interface ConnState {
  conn: Connection;
  playerId: string | null;
}

/**
 * The game "server", running inside the host's browser. Phones talk to it through
 * Connections; the host screen calls `hostAction` directly. It keeps every device's view in
 * sync, saves the game after each change and runs the automatic phase changes.
 */
export class HostController {
  readonly game: Game;
  private conns = new Map<string, ConnState>();
  private listeners = new Set<() => void>();
  private autoTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    saved: Game | null,
    private readonly save: (game: Game) => void,
    private readonly build: string,
  ) {
    if (saved) engine.migrateGame(saved);
    this.game = saved ?? engine.createGame();
    this.scheduleAutoAdvance();
  }

  /** The host screen's own view: public state only, no player secrets. */
  view(): ClientState {
    return clientView(this.game, null, this.isConnected, this.build);
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Host-screen actions. Throws GameError for the host UI to show. */
  hostAction(event: HostEvent, ...args: unknown[]) {
    const g = this.game;
    switch (event) {
      case 'host:setup':
        engine.configure(g, args[0] as engine.SetupPayload);
        break;
      case 'host:backToSetup':
        engine.backToSetup(g);
        break;
      case 'host:releaseClaim':
        engine.releaseClaim(g, args[0] as string);
        break;
      case 'host:start':
      case 'host:playAgain':
        engine.startGame(g);
        break;
      case 'host:advance':
        engine.advance(g);
        break;
      case 'host:forceNight':
        engine.resolveNight(g, true);
        break;
      case 'host:reset':
        engine.resetGame(g);
        break;
    }
    this.changed();
  }

  connect(conn: Connection) {
    this.conns.set(conn.id, { conn, playerId: null });
    this.sendState(this.conns.get(conn.id)!);
  }

  disconnect(connId: string) {
    if (this.conns.delete(connId)) this.changed();
  }

  receive(connId: string, raw: unknown) {
    const c = this.conns.get(connId);
    if (!c || !raw || typeof raw !== 'object') return;
    const msg = raw as ClientMessage;
    try {
      if (msg.t === 'hello') {
        const id = msg.token ? engine.resume(this.game, msg.token) : null;
        c.playerId = id;
        if (msg.token && !id) c.conn.send({ t: 'token-invalid' });
      } else if (msg.t === 'act' && (PLAYER_EVENTS as readonly string[]).includes(msg.event)) {
        this.playerAction(c, msg.event, Array.isArray(msg.args) ? msg.args : []);
      } else {
        return;
      }
      this.changed();
    } catch (err) {
      if (!(err instanceof engine.GameError)) console.error(err);
      c.conn.send({ t: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  }

  private playerAction(c: ConnState, event: string, args: unknown[]) {
    const g = this.game;
    const me = () => {
      if (!c.playerId) throw new engine.GameError('Pick your name first.');
      return c.playerId;
    };
    switch (event) {
      case 'player:claim': {
        const token = engine.claim(g, args[0] as string);
        c.playerId = args[0] as string;
        c.conn.send({ t: 'token', token });
        break;
      }
      case 'player:leave': {
        const id = me();
        c.playerId = null;
        engine.releaseClaim(g, id);
        break;
      }
      case 'player:ackRole':
        engine.ackRole(g, me());
        break;
      case 'player:nightPick':
        engine.setNightPick(g, me(), args[0] as string | null);
        break;
      case 'player:nightConfirm':
        engine.confirmNight(g, me());
        break;
      case 'player:suspect':
        engine.setSuspect(g, me(), args[0] as string);
        break;
      case 'player:vote':
        engine.castVote(g, me(), args[0] as Ballot);
        break;
      case 'player:readyToVote':
        engine.setReadyToVote(g, me(), !!args[0]);
        break;
    }
  }

  private isConnected = (playerId: string) => {
    for (const c of this.conns.values()) if (c.playerId === playerId) return true;
    return false;
  };

  private sendState(c: ConnState) {
    c.conn.send({ t: 'state', state: clientView(this.game, c.playerId, this.isConnected, this.build), build: this.build });
  }

  /** After any change: save, update every phone and the host screen, re-arm the timer. */
  private changed() {
    for (const c of this.conns.values()) {
      // Forget identities whose seat was released or renamed away.
      if (c.playerId && !this.game.players.some((p) => p.id === c.playerId && p.token)) c.playerId = null;
      this.sendState(c);
    }
    this.save(this.game);
    this.scheduleAutoAdvance();
    for (const l of this.listeners) l();
  }

  private scheduleAutoAdvance() {
    if (this.autoTimer) clearTimeout(this.autoTimer);
    this.autoTimer = null;
    const at = this.game.autoAdvanceAt;
    if (at === null) return;
    this.autoTimer = setTimeout(() => {
      try {
        if (engine.tick(this.game)) this.changed();
        else this.scheduleAutoAdvance();
      } catch (err) {
        console.error(err);
      }
    }, Math.max(0, at - Date.now()) + 50);
  }

  dispose() {
    if (this.autoTimer) clearTimeout(this.autoTimer);
  }
}
