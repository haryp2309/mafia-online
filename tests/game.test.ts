import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, PRESET_ROLES } from '../shared/roles';
import type { Game, Settings } from '../shared/types';
import {
  ackRole,
  advance,
  castVote,
  claim,
  configure,
  confirmNight,
  createGame,
  GameError,
  migrateGame,
  resolveNight,
  setNightPick,
  setReadyToVote,
  setSuspect,
  startGame,
  tick,
  validTargets,
} from '../shared/game';
import { clientView } from '../shared/views';
import { STORIES } from '../shared/stories';

const NAMES = ['Ann', 'Bob', 'Cat', 'Dan', 'Eve', 'Fay'];

/** Builds a game in NIGHT 1 with a fixed role assignment: Ann+Bob mafia, Cat police, Dan doctor, Eve+Fay farmers. */
function setup(settings: Partial<Settings> = {}): Game & { id: Record<string, string> } {
  const game = createGame();
  configure(game, {
    names: NAMES,
    roles: PRESET_ROLES,
    roleCounts: { mafia: 2, police: 1, doctor: 1, farmer: 2 },
    settings: { ...DEFAULT_SETTINGS, ...settings },
  });
  for (const p of game.players) claim(game, p.id);
  startGame(game);
  const assign = ['mafia', 'mafia', 'police', 'doctor', 'farmer', 'farmer'];
  game.players.forEach((p, i) => (p.roleId = assign[i]));
  advance(game); // ROLE_REVEAL -> NIGHT
  const id = Object.fromEntries(game.players.map((p) => [p.name, p.id]));
  return Object.assign(game, { id });
}

/** Removes a player before the night is played, as if they died earlier. */
function kill(g: ReturnType<typeof setup>, name: string) {
  g.players.find((p) => p.name === name)!.alive = false;
  delete g.nightPicks[g.id[name]];
}

function act(game: Game, actorId: string, targetId: string) {
  setNightPick(game, actorId, targetId);
  return confirmNight(game, actorId);
}

/** Every living player answers "who do you suspect?": the first other living player in seat order. */
function suspectAll(g: Game) {
  const living = g.players.filter((p) => p.alive);
  for (const p of living) setSuspect(g, p.id, living.find((o) => o.id !== p.id)!.id);
}

/** Everyone suspects, then mafia kill `kill`, doctor saves `save`, police checks `check`. */
function playNight(g: ReturnType<typeof setup>, kill: string, save: string, check: string) {
  const { id } = g;
  const alive = (name: string) => g.players.find((p) => p.id === id[name])!.alive;
  suspectAll(g);
  const plan: [string, string][] = [
    ['Ann', kill],
    ['Bob', kill],
    ['Cat', check],
    ['Dan', save],
  ];
  for (const [actor, target] of plan) if (alive(actor)) act(g, id[actor], id[target]);
}

describe('setup', () => {
  it('rejects counts that do not add up', () => {
    const game = createGame();
    expect(() =>
      configure(game, { names: NAMES, roles: PRESET_ROLES, roleCounts: { mafia: 1 }, settings: DEFAULT_SETTINGS }),
    ).toThrow(GameError);
  });

  it('deals exactly the configured roles', () => {
    const game = createGame();
    configure(game, {
      names: NAMES,
      roles: PRESET_ROLES,
      roleCounts: { mafia: 2, police: 1, doctor: 1, farmer: 2 },
      settings: DEFAULT_SETTINGS,
    });
    for (const p of game.players) claim(game, p.id);
    startGame(game);
    const counts: Record<string, number> = {};
    for (const p of game.players) counts[p.roleId!] = (counts[p.roleId!] ?? 0) + 1;
    expect(counts).toEqual({ mafia: 2, police: 1, doctor: 1, farmer: 2 });
  });

  it('will not start until everyone has claimed a name', () => {
    const game = createGame();
    configure(game, {
      names: NAMES,
      roles: PRESET_ROLES,
      roleCounts: { mafia: 2, police: 1, doctor: 1, farmer: 2 },
      settings: DEFAULT_SETTINGS,
    });
    claim(game, game.players[0].id);
    expect(() => startGame(game)).toThrow(/Waiting for/);
    expect(() => claim(game, game.players[0].id)).toThrow(/already/);
  });
});

describe('night', () => {
  it('kills the mafia target', () => {
    const g = setup();
    playNight(g, 'Eve', 'Fay', 'Ann');
    expect(g.phase).toBe('MORNING');
    expect(g.morning!.killedIds).toEqual([g.id.Eve]);
    expect(g.players.find((p) => p.name === 'Eve')!.alive).toBe(false);
  });

  it('doctor saves the target', () => {
    const g = setup();
    playNight(g, 'Eve', 'Eve', 'Ann');
    expect(g.morning!.killedIds).toEqual([]);
    expect(g.players.every((p) => p.alive)).toBe(true);
  });

  it('police learn the truth privately', () => {
    const g = setup();
    playNight(g, 'Eve', 'Fay', 'Ann');
    expect(g.investigations[g.id.Cat]).toEqual([{ night: 1, targetId: g.id.Ann, isMafia: true }]);
    expect(clientView(g, g.id.Cat, () => true).me!.investigations).toHaveLength(1);
    expect(clientView(g, g.id.Dan, () => true).me!.investigations).toHaveLength(0);
  });

  it('records anonymous suspicions from everyone, whatever their role', () => {
    const g = setup();
    playNight(g, 'Cat', 'Fay', 'Ann');
    // Ann suspects Bob; the other five suspect Ann.
    expect(g.morning!.suspicions).toEqual({ [g.id.Bob]: 1, [g.id.Ann]: 5 });
  });

  it('the night waits for every suspicion, even after all actions are done', () => {
    const g = setup();
    for (const [actor, target] of [['Ann', 'Eve'], ['Bob', 'Eve'], ['Cat', 'Ann'], ['Dan', 'Fay']]) {
      act(g, g.id[actor], g.id[target]);
    }
    expect(g.phase).toBe('NIGHT');
    const living = g.players.filter((p) => p.alive);
    for (const p of living.slice(0, -1)) expect(setSuspect(g, p.id, living.find((o) => o.id !== p.id)!.id)).toBe(false);
    expect(setSuspect(g, g.id.Fay, g.id.Ann)).toBe(true);
    expect(g.morning!.killedIds).toEqual([g.id.Eve]);
  });

  it('farmers have no night action, only a suspicion', () => {
    const g = setup();
    expect(() => setNightPick(g, g.id.Eve, g.id.Ann)).toThrow(GameError);
    const night = clientView(g, g.id.Eve, () => true).me!.night!;
    expect(night.kind).toBeNull();
    expect(night.suspect.validTargets).not.toContain(g.id.Eve);
    expect(() => setSuspect(g, g.id.Eve, g.id.Eve)).toThrow(GameError);
  });

  it('mafia cannot target each other', () => {
    const g = setup();
    expect(validTargets(g, g.players[0])).not.toContain(g.id.Bob);
    expect(() => setNightPick(g, g.id.Ann, g.id.Bob)).toThrow(GameError);
  });

  it('unanimous: night waits until mafia agree', () => {
    const g = setup();
    suspectAll(g);
    act(g, g.id.Ann, g.id.Eve);
    act(g, g.id.Bob, g.id.Fay);
    act(g, g.id.Cat, g.id.Ann);
    expect(act(g, g.id.Dan, g.id.Dan)).toBe(false);
    expect(g.phase).toBe('NIGHT');
    expect(act(g, g.id.Bob, g.id.Eve)).toBe(true);
    expect(g.morning!.killedIds).toEqual([g.id.Eve]);
  });

  it('first: the first mafia confirmation decides for the group', () => {
    const g = setup({ groupConsensus: 'first' });
    act(g, g.id.Ann, g.id.Eve);
    expect(g.nightPicks[g.id.Bob]).toMatchObject({ targetId: g.id.Eve, confirmed: true });
  });

  it('doctor may self-save only once by default', () => {
    const g = setup();
    playNight(g, 'Eve', 'Dan', 'Ann');
    expect(g.selfSavesUsed[g.id.Dan]).toBe(1);
    advance(g); // -> discussion
    advance(g); // -> vote
    for (const p of g.players.filter((p) => p.alive)) castVote(g, p.id, 'skip');
    advance(g); // -> night 2
    expect(validTargets(g, g.players.find((p) => p.name === 'Dan')!)).not.toContain(g.id.Dan);
  });

  it('doctorNoRepeat blocks protecting the same person twice in a row', () => {
    const g = setup({ doctorNoRepeat: true });
    playNight(g, 'Eve', 'Fay', 'Ann');
    advance(g);
    advance(g);
    for (const p of g.players.filter((p) => p.alive)) castVote(g, p.id, 'skip');
    advance(g);
    expect(validTargets(g, g.players.find((p) => p.name === 'Dan')!)).not.toContain(g.id.Fay);
  });

  it('host can force a stuck night', () => {
    const g = setup();
    act(g, g.id.Dan, g.id.Eve);
    resolveNight(g, true);
    expect(g.phase).toBe('MORNING');
    expect(g.morning!.killedIds).toEqual([]);
  });
});

describe('day vote', () => {
  function toVote(settings: Partial<Settings> = {}) {
    const g = setup(settings);
    playNight(g, 'Eve', 'Eve', 'Ann'); // nobody dies
    advance(g);
    advance(g);
    expect(g.phase).toBe('DAY_VOTE');
    return g;
  }

  it('plurality eliminates', () => {
    const g = toVote();
    const { id } = g;
    castVote(g, id.Ann, id.Cat);
    castVote(g, id.Bob, id.Cat);
    castVote(g, id.Cat, id.Ann);
    castVote(g, id.Dan, id.Ann);
    castVote(g, id.Eve, id.Ann);
    castVote(g, id.Fay, 'skip');
    expect(g.phase).toBe('VOTE_RESULT');
    expect(g.voteResult!.eliminatedId).toBe(id.Ann);
  });

  it('tie means nobody is eliminated by default', () => {
    const g = toVote();
    const { id } = g;
    castVote(g, id.Ann, id.Cat);
    castVote(g, id.Bob, id.Cat);
    castVote(g, id.Cat, id.Ann);
    castVote(g, id.Dan, id.Ann);
    castVote(g, id.Eve, id.Cat);
    castVote(g, id.Fay, id.Ann);
    expect(g.voteResult!.eliminatedId).toBeNull();
    expect(g.voteResult!.tie).toBe(true);
  });

  it('tie triggers a revote when configured', () => {
    const g = toVote({ tieRule: 'revote' });
    const { id } = g;
    castVote(g, id.Ann, id.Cat);
    castVote(g, id.Bob, id.Cat);
    castVote(g, id.Cat, id.Ann);
    castVote(g, id.Dan, id.Ann);
    castVote(g, id.Eve, id.Cat);
    castVote(g, id.Fay, id.Ann);
    expect(g.phase).toBe('DAY_VOTE');
    expect(g.vote!.candidates.sort()).toEqual([id.Ann, id.Cat].sort());
  });

  it('cannot vote for yourself', () => {
    const g = toVote();
    expect(() => castVote(g, g.id.Ann, g.id.Ann)).toThrow(GameError);
  });
});

describe('win conditions', () => {
  it('town wins when all mafia are gone', () => {
    const g = setup();
    kill(g, 'Ann');
    playNight(g, 'Eve', 'Eve', 'Bob');
    advance(g);
    advance(g);
    const { id } = g;
    for (const v of ['Cat', 'Dan', 'Eve', 'Fay']) castVote(g, id[v], id.Bob);
    castVote(g, id.Bob, id.Cat);
    expect(g.winner).toBe('town');
    advance(g);
    expect(g.phase).toBe('GAME_OVER');
  });

  it('mafia win when they equal the town', () => {
    const g = setup();
    kill(g, 'Cat');
    kill(g, 'Dan');
    playNight(g, 'Eve', 'Eve', 'Ann');
    expect(g.winner).toBe('mafia');
  });
});

describe('information hiding', () => {
  it('never exposes living players roles to others', () => {
    const g = setup();
    const view = clientView(g, g.id.Eve, () => true);
    expect(view.public.players.every((p) => p.roleId === undefined)).toBe(true);
    expect(view.me!.teammates).toEqual([]);
    expect(JSON.stringify(view)).not.toContain('"roleId":"mafia"');
  });

  it('mafia see each other and their live picks', () => {
    const g = setup();
    setNightPick(g, g.id.Ann, g.id.Eve);
    const me = clientView(g, g.id.Bob, () => true).me!;
    expect(me.teammates.map((t) => t.name)).toEqual(['Ann']);
    expect(me.night!.group!.find((m) => m.name === 'Ann')!.targetId).toBe(g.id.Eve);
  });

  it('reveals a dead player role when configured', () => {
    const g = setup();
    playNight(g, 'Eve', 'Fay', 'Ann');
    const eve = clientView(g, null, () => true).public.players.find((p) => p.name === 'Eve')!;
    expect(eve.roleId).toBe('farmer');
  });
});

describe('skip votes', () => {
  it('nobody is eliminated when skip ties the leader', () => {
    const g = setup();
    playNight(g, 'Eve', 'Eve', 'Ann');
    advance(g);
    advance(g);
    const { id } = g;
    castVote(g, id.Ann, id.Cat);
    castVote(g, id.Bob, id.Cat);
    castVote(g, id.Cat, 'skip');
    castVote(g, id.Dan, 'skip');
    castVote(g, id.Eve, id.Dan);
    castVote(g, id.Fay, id.Dan);
    expect(g.voteResult).toMatchObject({ eliminatedId: null, tie: false });
  });
});

describe('saved games from before everyone suspected', () => {
  it('turns a farmer pick into a suspicion and asks action roles for one', () => {
    const g = setup();
    // Old format: no suspectId; Eve (farmer) had confirmed her suspicion as her pick.
    g.nightPicks = Object.fromEntries(g.players.map((p) => [p.id, { targetId: null, confirmed: false }])) as never;
    Object.assign(g.nightPicks[g.id.Eve], { targetId: g.id.Ann, confirmed: true });
    Object.assign(g.nightPicks[g.id.Ann], { targetId: g.id.Cat, confirmed: true });
    migrateGame(g);
    expect(g.nightPicks[g.id.Eve]).toEqual({ targetId: null, confirmed: true, suspectId: g.id.Ann });
    expect(g.nightPicks[g.id.Fay]).toEqual({ targetId: null, confirmed: true, suspectId: null });
    expect(g.nightPicks[g.id.Ann]).toEqual({ targetId: g.id.Cat, confirmed: true, suspectId: null });
  });
});

describe('death reveals', () => {
  const publicPlayer = (g: ReturnType<typeof setup>, name: string) =>
    clientView(g, null, () => true).public.players.find((p) => p.name === name)!;

  function voteOut(g: ReturnType<typeof setup>, name: string) {
    advance(g);
    advance(g);
    for (const p of g.players.filter((p) => p.alive)) castVote(g, p.id, p.name === name ? g.id.Ann : g.id[name]);
  }

  it('by default a night death shows the role, a vote shows only mafia or not', () => {
    const g = setup();
    playNight(g, 'Eve', 'Fay', 'Ann');
    expect(publicPlayer(g, 'Eve')).toMatchObject({ roleId: 'farmer' });
    voteOut(g, 'Bob');
    const bob = publicPlayer(g, 'Bob');
    expect(bob.isMafia).toBe(true);
    expect(bob.roleId).toBeUndefined();
    expect(g.log.at(-1)).toContain('Bob (mafia)');
  });

  it('can hide everything about night deaths', () => {
    const g = setup({ revealNightDeath: 'none' });
    playNight(g, 'Eve', 'Fay', 'Ann');
    const eve = publicPlayer(g, 'Eve');
    expect(eve.roleId).toBeUndefined();
    expect(eve.isMafia).toBeUndefined();
    expect(JSON.stringify(clientView(g, g.id.Fay, () => true))).not.toContain('"roleId":"farmer"');
  });

  it('reveals every role at game over regardless', () => {
    const g = setup({ revealNightDeath: 'none', revealDayDeath: 'none' });
    kill(g, 'Cat');
    kill(g, 'Dan');
    playNight(g, 'Eve', 'Eve', 'Ann');
    advance(g);
    expect(g.phase).toBe('GAME_OVER');
    expect(clientView(g, null, () => true).public.players.every((p) => p.roleId)).toBe(true);
  });
});

describe('less clicking for the host', () => {
  it('starts the night shortly after everyone has seen their role', () => {
    const game = createGame();
    configure(game, {
      names: NAMES,
      roles: PRESET_ROLES,
      roleCounts: { mafia: 2, police: 1, doctor: 1, farmer: 2 },
      settings: DEFAULT_SETTINGS,
    });
    for (const p of game.players) claim(game, p.id);
    startGame(game);
    for (const p of game.players) ackRole(game, p.id, 1000);
    expect(game.autoAdvanceAt).toBe(4000);
    expect(tick(game, 3999)).toBe(false);
    expect(tick(game, 4000)).toBe(true);
    expect(game.phase).toBe('NIGHT');
  });

  it('moves from morning to the day, and from the vote result to night, by itself', () => {
    const g = setup({ autoAdvanceSeconds: 10 });
    playNight(g, 'Eve', 'Eve', 'Ann');
    expect(g.phase).toBe('MORNING');
    expect(tick(g, g.autoAdvanceAt! - 1)).toBe(false);
    expect(tick(g, g.autoAdvanceAt!)).toBe(true);
    expect(g.phase).toBe('DAY_DISCUSSION');
    for (const p of g.players) setReadyToVote(g, p.id, true);
    for (const p of g.players) castVote(g, p.id, 'skip');
    expect(g.phase).toBe('VOTE_RESULT');
    tick(g, g.autoAdvanceAt!);
    expect(g.phase).toBe('NIGHT');
    expect(g.round).toBe(2);
  });

  it('waits for the host when auto-advance is off', () => {
    const g = setup({ autoAdvanceSeconds: 0 });
    playNight(g, 'Eve', 'Eve', 'Ann');
    expect(g.autoAdvanceAt).toBeNull();
    expect(tick(g, Date.now() + 1e9)).toBe(false);
  });

  it('starts the vote once every living player is ready', () => {
    const g = setup();
    playNight(g, 'Eve', 'Fay', 'Ann');
    advance(g);
    const living = g.players.filter((p) => p.alive);
    for (const p of living.slice(0, -1)) setReadyToVote(g, p.id, true);
    setReadyToVote(g, living[0].id, false);
    setReadyToVote(g, living.at(-1)!.id, true);
    expect(g.phase).toBe('DAY_DISCUSSION');
    setReadyToVote(g, living[0].id, true);
    expect(g.phase).toBe('DAY_VOTE');
    expect(() => setReadyToVote(g, g.id.Eve, true)).toThrow(GameError);
  });

  it('starts the vote when the discussion timer runs out', () => {
    const g = setup({ discussionSeconds: 60 });
    playNight(g, 'Eve', 'Fay', 'Ann');
    advance(g, 0);
    expect(g.autoAdvanceAt).toBe(60_000);
    tick(g, 60_000);
    expect(g.phase).toBe('DAY_VOTE');
  });
});

describe('stories', () => {
  it('has ten complete storylines', () => {
    expect(STORIES).toHaveLength(10);
    expect(new Set(STORIES.map((s) => s.id)).size).toBe(10);
    for (const st of STORIES) {
      for (const lines of [st.night, st.death, st.quiet, st.voteOut, st.noVote]) expect(lines.length).toBeGreaterThan(0);
      for (const line of [...st.death, ...st.voteOut]) expect(line).toContain('{name}');
    }
  });

  it('knows the story before the game starts, and the next one at game over', () => {
    const game = createGame();
    configure(game, {
      names: NAMES,
      roles: PRESET_ROLES,
      roleCounts: { mafia: 2, police: 1, doctor: 1, farmer: 2 },
      settings: DEFAULT_SETTINGS,
    });
    const first = game.storyId;
    expect(first).toBeTruthy();
    for (const p of game.players) claim(game, p.id);
    startGame(game);
    expect(game.storyId).toBe(first);
    game.winner = 'town';
    game.phase = 'VOTE_RESULT';
    advance(game);
    expect(game.phase).toBe('GAME_OVER');
    const next = game.nextStoryId;
    expect(next).toBeTruthy();
    expect(next).not.toBe(first);
    startGame(game);
    expect(game.storyId).toBe(next);
  });

  it('picks a story per game, or the one the host chose', () => {
    const g = setup();
    expect(STORIES.map((s) => s.id)).toContain(g.storyId);
    expect(setup({ story: 'pirate' }).storyId).toBe('pirate');
  });
});

describe('saved games from before reveal options', () => {
  it('keeps the old reveal setting and turns auto-advance off', () => {
    const g = setup();
    const legacy = g.settings as unknown as Record<string, unknown>;
    for (const k of ['revealNightDeath', 'revealDayDeath', 'autoAdvanceSeconds', 'story', 'policeTogether']) delete legacy[k];
    legacy.revealRoleOnDeath = false;
    migrateGame(g);
    expect(g.settings).toMatchObject({
      revealNightDeath: 'none',
      revealDayDeath: 'none',
      autoAdvanceSeconds: 0,
      story: 'random',
      policeTogether: false,
    });
    expect('revealRoleOnDeath' in g.settings).toBe(false);
  });

  it('uses the new defaults when no game is in progress', () => {
    const g = createGame();
    const legacy = g.settings as unknown as Record<string, unknown>;
    for (const k of ['revealNightDeath', 'revealDayDeath', 'autoAdvanceSeconds', 'story', 'policeTogether']) delete legacy[k];
    legacy.revealRoleOnDeath = true;
    migrateGame(g);
    expect(g.settings).toMatchObject({
      revealNightDeath: 'role',
      revealDayDeath: 'team',
      autoAdvanceSeconds: 10,
      policeTogether: true,
    });
  });
});

describe('day stats', () => {
  it("keeps yesterday's ballots and last night's suspicions available during the next discussion", () => {
    const g = setup();
    playNight(g, 'Eve', 'Eve', 'Ann');
    advance(g);
    advance(g);
    for (const p of g.players) castVote(g, p.id, 'skip');
    advance(g); // night 2
    playNight(g, 'Fay', 'Eve', 'Bob');
    advance(g); // day 2 discussion
    const pub = clientView(g, null, () => true).public;
    expect(pub.phase).toBe('DAY_DISCUSSION');
    expect(pub.round).toBe(2);
    expect(Object.keys(pub.voteResult!.ballots)).toHaveLength(6);
    expect(Object.values(pub.morning!.suspicions).reduce((a, b) => a + b, 0)).toBe(6);
  });
});

describe('police together', () => {
  /** Ann+Bob mafia, Cat+Dan police, Eve doctor, Fay+Gus farmers; in NIGHT 1. */
  function twoPolice(policeTogether: boolean) {
    const game = createGame();
    configure(game, {
      names: [...NAMES, 'Gus'],
      roles: PRESET_ROLES,
      roleCounts: { mafia: 2, police: 2, doctor: 1, farmer: 2 },
      settings: { ...DEFAULT_SETTINGS, policeTogether },
    });
    for (const p of game.players) claim(game, p.id);
    startGame(game);
    const assign = ['mafia', 'mafia', 'police', 'police', 'doctor', 'farmer', 'farmer'];
    game.players.forEach((p, i) => (p.roleId = assign[i]));
    advance(game);
    const id = Object.fromEntries(game.players.map((p) => [p.name, p.id]));
    return Object.assign(game, { id });
  }

  function finishOthers(g: ReturnType<typeof twoPolice>) {
    const living = g.players.filter((p) => p.alive);
    for (const p of living) setSuspect(g, p.id, living.find((o) => o.id !== p.id)!.id);
    act(g, g.id.Ann, g.id.Fay);
    act(g, g.id.Bob, g.id.Fay);
    act(g, g.id.Eve, g.id.Eve);
  }

  it('police see each other and must agree, then both learn the result', () => {
    const g = twoPolice(true);
    expect(clientView(g, g.id.Cat, () => true).me!.teammates.map((t) => t.name)).toEqual(['Dan']);
    finishOthers(g);
    act(g, g.id.Cat, g.id.Ann);
    expect(act(g, g.id.Dan, g.id.Bob)).toBe(false);
    expect(clientView(g, g.id.Cat, () => true).me!.night!.groupSettled).toBe(false);
    expect(act(g, g.id.Dan, g.id.Ann)).toBe(true);
    for (const cop of ['Cat', 'Dan']) {
      expect(g.investigations[g.id[cop]]).toEqual([{ night: 1, targetId: g.id.Ann, isMafia: true }]);
    }
  });

  it('police working together cannot investigate each other', () => {
    const g = twoPolice(true);
    const cat = g.players.find((p) => p.name === 'Cat')!;
    expect(validTargets(g, cat)).not.toContain(g.id.Dan);
    expect(() => setNightPick(g, g.id.Cat, g.id.Dan)).toThrow(GameError);
    const alone = twoPolice(false);
    expect(validTargets(alone, alone.players.find((p) => p.name === 'Cat')!)).toContain(alone.id.Dan);
  });

  it('with the option off, each police investigates alone', () => {
    const g = twoPolice(false);
    expect(clientView(g, g.id.Cat, () => true).me!.teammates).toEqual([]);
    finishOthers(g);
    act(g, g.id.Cat, g.id.Ann);
    expect(act(g, g.id.Dan, g.id.Fay)).toBe(true);
    expect(g.investigations[g.id.Cat]).toEqual([{ night: 1, targetId: g.id.Ann, isMafia: true }]);
    expect(g.investigations[g.id.Dan]).toEqual([{ night: 1, targetId: g.id.Fay, isMafia: false }]);
  });
});

describe('suicide bomber', () => {
  /** Ann+Bob mafia, Cat police, Dan doctor, Eve bomber, Fay+Gus farmers; in NIGHT 1. */
  function withBomber() {
    const game = createGame();
    configure(game, {
      names: [...NAMES, 'Gus'],
      roles: PRESET_ROLES,
      roleCounts: { mafia: 2, police: 1, doctor: 1, farmer: 2, bomber: 1 },
      settings: DEFAULT_SETTINGS,
    });
    for (const p of game.players) claim(game, p.id);
    startGame(game);
    const assign = ['mafia', 'mafia', 'police', 'doctor', 'bomber', 'farmer', 'farmer'];
    game.players.forEach((p, i) => (p.roleId = assign[i]));
    advance(game);
    const id = Object.fromEntries(game.players.map((p) => [p.name, p.id]));
    return Object.assign(game, { id });
  }

  function night(g: ReturnType<typeof withBomber>, kill: string) {
    const living = g.players.filter((p) => p.alive);
    for (const p of living) setSuspect(g, p.id, living.find((o) => o.id !== p.id)!.id);
    act(g, g.id.Ann, g.id[kill]);
    act(g, g.id.Bob, g.id[kill]);
    act(g, g.id.Cat, g.id.Ann);
    act(g, g.id.Dan, g.id.Dan);
  }

  it('wins alone when voted out; everyone else loses', () => {
    const g = withBomber();
    night(g, 'Fay');
    advance(g);
    advance(g);
    for (const p of g.players.filter((p) => p.alive)) castVote(g, p.id, p.name === 'Eve' ? g.id.Ann : g.id.Eve);
    expect(g.phase).toBe('VOTE_RESULT');
    expect(g.soloWinnerId).toBe(g.id.Eve);
    expect(g.winner).toBe('neutral');
    advance(g);
    expect(g.phase).toBe('GAME_OVER');
    const pub = clientView(g, null, () => true).public;
    expect(pub.soloWinnerId).toBe(g.id.Eve);
    expect(pub.players.find((p) => p.name === 'Eve')!.roleId).toBe('bomber');
  });

  it('dies quietly when the mafia kills them at night', () => {
    const g = withBomber();
    night(g, 'Eve');
    expect(g.players.find((p) => p.name === 'Eve')!.alive).toBe(false);
    expect(g.winner).toBeNull();
    expect(g.soloWinnerId).toBeNull();
  });

  it('has no team, no night action, and looks innocent to police', () => {
    const g = withBomber();
    const me = clientView(g, g.id.Eve, () => true).me!;
    expect(me.teammates).toEqual([]);
    expect(me.night!.kind).toBeNull();
    const living = g.players.filter((p) => p.alive);
    for (const p of living) setSuspect(g, p.id, living.find((o) => o.id !== p.id)!.id);
    act(g, g.id.Ann, g.id.Fay);
    act(g, g.id.Bob, g.id.Fay);
    act(g, g.id.Cat, g.id.Eve);
    act(g, g.id.Dan, g.id.Dan);
    expect(g.investigations[g.id.Cat]).toEqual([{ night: 1, targetId: g.id.Eve, isMafia: false }]);
  });

  it('is added to saved setups that predate it, with a count of 0', () => {
    const g = createGame();
    g.roles = g.roles.filter((r) => r.id !== 'bomber');
    delete g.roleCounts.bomber;
    migrateGame(g);
    expect(g.roles.map((r) => r.id)).toContain('bomber');
    expect(g.roleCounts.bomber).toBe(0);
  });
});
