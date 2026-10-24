import Peer, { type DataConnection } from 'peerjs';
import { useEffect, useState } from 'react';
import { normaliseRoomCode, PEER_PREFIX, type ClientMessage, type HostMessage } from '../../shared/protocol';
import type { ClientState } from '../../shared/types';
import { iceServers } from './net/ice';

/**
 * Test helper: /bots?room=ABCDE&except=Ann,Bob fills every other empty seat with a bot that
 * plays randomly (mafia and police bots follow their group's first member so groups agree).
 */
const params = new URLSearchParams(window.location.search);
const ROOM = normaliseRoomCode(params.get('room') ?? '');
const EXCEPT = new Set(
  (params.get('except') ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
);

const pickRandom = <T,>(items: T[]): T | undefined => items[Math.floor(Math.random() * items.length)];

interface BotInfo {
  name: string;
  status: string;
}

function startBot(playerId: string, name: string, report: (status: string) => void) {
  let conn: DataConnection | null = null;
  let lastAction = '';
  let phase = '';
  const send = (msg: ClientMessage) => conn?.open && conn.send(msg);
  const act = (event: ClientMessage & { t: 'act' }) => send(event);
  const once = (key: string, fn: () => void) => {
    if (key === lastAction) return;
    lastAction = key;
    const scheduledIn = phase;
    setTimeout(() => phase === scheduledIn && fn(), 300 + Math.random() * 700);
  };

  const onState = ({ public: pub, you, me }: ClientState) => {
    const next = `${pub.phase}:${pub.round}`;
    if (next !== phase) lastAction = '';
    phase = next;
    report(pub.phase);
    if (!you) {
      const seat = pub.players.find((p) => p.id === playerId);
      if (pub.phase !== 'SETUP' && seat && !seat.claimed) {
        once(`claim:${pub.phase}`, () => act({ t: 'act', event: 'player:claim', args: [playerId] }));
      }
      return;
    }
    const alive = pub.players.find((p) => p.id === you.id)?.alive;
    if (pub.phase === 'ROLE_REVEAL' && me && !me.ackedRole) once('ack', () => act({ t: 'act', event: 'player:ackRole', args: [] }));
    if (pub.phase === 'NIGHT' && me?.night) {
      const night = me.night;
      const actionPending = !!night.kind && (!night.confirmed || night.groupSettled === false);
      if (actionPending) {
        const leader = night.group?.[0];
        const target = leader && leader.playerId !== you.id ? leader.targetId : (night.pick ?? pickRandom(night.validTargets));
        if (!target) return;
        if (night.pick !== target) once(`pick:${pub.round}:${target}`, () => act({ t: 'act', event: 'player:nightPick', args: [target] }));
        else if (!night.confirmed) once(`confirm:${pub.round}:${target}`, () => act({ t: 'act', event: 'player:nightConfirm', args: [] }));
      } else if (!night.suspect.pick) {
        const s = pickRandom(night.suspect.validTargets);
        if (s) once(`suspect:${pub.round}`, () => act({ t: 'act', event: 'player:suspect', args: [s] }));
      }
    }
    if (pub.phase === 'DAY_DISCUSSION' && alive && me && !me.readyToVote) {
      once(`ready:${pub.round}`, () => act({ t: 'act', event: 'player:readyToVote', args: [true] }));
    }
    if (pub.phase === 'DAY_VOTE' && alive && me && !me.myVote && pub.vote) {
      const options = pub.vote.candidates.filter((id) => id !== you.id);
      const ballot = Math.random() < 0.2 ? 'skip' : (pickRandom(options) ?? 'skip');
      once(`vote:${pub.round}:${pub.vote.isRevote}`, () => act({ t: 'act', event: 'player:vote', args: [ballot] }));
    }
  };

  // Like a real phone: keep the seat token and reconnect if the host reloads.
  let token: string | null = null;
  void iceServers().then((ice) => {
    const peer = new Peer({ config: { iceServers: ice } });
    const connect = () => {
      const c = peer.connect(PEER_PREFIX + ROOM, { reliable: true });
      conn = c;
      c.on('open', () => {
        report('connected');
        send({ t: 'hello', build: __BUILD__, token });
      });
      c.on('data', (d) => {
        const msg = d as HostMessage;
        if (msg.t === 'state') onState(msg.state);
        if (msg.t === 'token') token = msg.token;
      });
      c.on('close', () => {
        report('reconnecting');
        setTimeout(connect, 2000);
      });
    };
    peer.on('open', connect);
    peer.on('error', (e) => {
      report(`error: ${e.type}`);
      if (e.type === 'peer-unavailable') setTimeout(connect, 3000);
    });
  });
}

export function BotsApp() {
  const [bots, setBots] = useState<Record<string, BotInfo>>({});
  const [note, setNote] = useState('Looking for empty seats…');

  useEffect(() => {
    if (ROOM.length !== 5) return setNote('Add ?room=ABCDE to the address.');
    const started = new Set<string>();
    void iceServers().then((ice) => {
      // A scout connection reads the seat list, then one bot connects per empty seat.
      const scout = new Peer({ config: { iceServers: ice } });
      scout.on('open', () => {
        const c = scout.connect(PEER_PREFIX + ROOM, { reliable: true });
        c.on('open', () => c.send({ t: 'hello', build: __BUILD__, token: null } satisfies ClientMessage));
        c.on('data', (d) => {
          const msg = d as HostMessage;
          if (msg.t !== 'state') return;
          const pub = msg.state.public;
          if (pub.phase === 'SETUP') return setNote('The host is still in setup.');
          setNote(`Room ${ROOM}: ${pub.phase}`);
          for (const p of pub.players) {
            if (p.claimed || EXCEPT.has(p.name.toLowerCase()) || started.has(p.id)) continue;
            started.add(p.id);
            setBots((b) => ({ ...b, [p.id]: { name: p.name, status: 'starting' } }));
            startBot(p.id, p.name, (status) => setBots((b) => ({ ...b, [p.id]: { name: p.name, status } })));
          }
        });
      });
      scout.on('error', (e) => setNote(`Scout error: ${e.type}`));
    });
  }, []);

  return (
    <div className="app">
      <div className="panel">
        <h1 className="title">🤖 Test bots</h1>
        <p>{note}</p>
        <ul className="player-list">
          {Object.entries(bots).map(([id, b]) => (
            <li key={id}>
              <span className="grow">{b.name}</span>
              <span className="small">{b.status}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
