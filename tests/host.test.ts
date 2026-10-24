import { describe, expect, it, vi } from 'vitest';
import { HostController, type Connection } from '../shared/host';
import type { HostMessage } from '../shared/protocol';
import { DEFAULT_SETTINGS, PRESET_ROLES } from '../shared/roles';
import type { Game } from '../shared/types';

function fakeConn(id: string) {
  const inbox: HostMessage[] = [];
  const conn: Connection = { id, send: (m) => inbox.push(m) };
  const last = <T extends HostMessage['t']>(t: T) =>
    [...inbox].reverse().find((m) => m.t === t) as Extract<HostMessage, { t: T }> | undefined;
  return { conn, inbox, last };
}

function hostWithLobby() {
  const save = vi.fn<(g: Game) => void>();
  const host = new HostController(null, save, 'build-1');
  host.hostAction('host:setup', {
    names: ['Ann', 'Bob', 'Cat', 'Dan', 'Eve'],
    roles: PRESET_ROLES,
    roleCounts: { mafia: 1, police: 1, doctor: 1, farmer: 2 },
    settings: DEFAULT_SETTINGS,
  });
  return { host, save };
}

describe('host controller', () => {
  it('sends state on connect and lets a phone claim a seat', () => {
    const { host, save } = hostWithLobby();
    const phone = fakeConn('c1');
    host.connect(phone.conn);
    expect(phone.last('state')!.state.public.phase).toBe('CLAIMING');
    const ann = host.game.players[0].id;
    host.receive('c1', { t: 'act', event: 'player:claim', args: [ann] });
    expect(phone.last('token')!.token).toBeTruthy();
    expect(phone.last('state')!.state.you!.name).toBe('Ann');
    expect(save).toHaveBeenCalled();
    expect(host.view().public.players[0]).toMatchObject({ claimed: true, connected: true });
  });

  it('restores a phone by its token after reconnecting', () => {
    const { host } = hostWithLobby();
    const first = fakeConn('c1');
    host.connect(first.conn);
    host.receive('c1', { t: 'act', event: 'player:claim', args: [host.game.players[1].id] });
    const token = first.last('token')!.token;
    host.disconnect('c1');
    expect(host.view().public.players[1].connected).toBe(false);

    const again = fakeConn('c2');
    host.connect(again.conn);
    host.receive('c2', { t: 'hello', build: 'build-1', token });
    expect(again.last('state')!.state.you!.name).toBe('Bob');
    host.receive('c2', { t: 'hello', build: 'build-1', token: 'nope' });
    expect(again.last('token-invalid')).toBeTruthy();
  });

  it('ignores host commands sent from a phone', () => {
    const { host } = hostWithLobby();
    const phone = fakeConn('c1');
    host.connect(phone.conn);
    host.receive('c1', { t: 'act', event: 'host:reset', args: [] } as never);
    expect(host.game.phase).toBe('CLAIMING');
  });

  it('reports game errors back to that phone only', () => {
    const { host } = hostWithLobby();
    const a = fakeConn('a');
    const b = fakeConn('b');
    host.connect(a.conn);
    host.connect(b.conn);
    const ann = host.game.players[0].id;
    host.receive('a', { t: 'act', event: 'player:claim', args: [ann] });
    host.receive('b', { t: 'act', event: 'player:claim', args: [ann] });
    expect(b.last('error')!.message).toMatch(/already been claimed/);
    expect(a.last('error')).toBeUndefined();
  });

  it('never sends one player another player’s role', () => {
    const { host } = hostWithLobby();
    const phones = host.game.players.map((p, i) => {
      const f = fakeConn(`c${i}`);
      host.connect(f.conn);
      host.receive(`c${i}`, { t: 'act', event: 'player:claim', args: [p.id] });
      return f;
    });
    host.hostAction('host:start');
    for (const [i, f] of phones.entries()) {
      const state = f.last('state')!.state;
      const others = host.game.players.filter((_, j) => j !== i);
      expect(state.me!.role.id).toBe(host.game.players[i].roleId);
      expect(state.public.players.filter((p) => p.roleId).length).toBe(0);
      for (const o of others) {
        if (o.roleId !== 'mafia' || host.game.players[i].roleId !== 'mafia') {
          expect(state.me!.teammates.map((t) => t.id)).not.toContain(o.id);
        }
      }
    }
  });

  it('resumes a saved game', () => {
    const { host } = hostWithLobby();
    const copy = JSON.parse(JSON.stringify(host.game)) as Game;
    const restored = new HostController(copy, () => {}, 'build-2');
    expect(restored.view().public.players.map((p) => p.name)).toEqual(['Ann', 'Bob', 'Cat', 'Dan', 'Eve']);
    expect(restored.view().public.build).toBe('build-2');
    restored.dispose();
    host.dispose();
  });
});
