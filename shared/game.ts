import { DEFAULT_SETTINGS, PRESET_ROLES } from './roles';
import { checkWinner, teamOf, validateSetup } from './rules';
import { STORIES } from './stories';
import type {
  Ballot,
  Game,
  NightActionKind,
  NightPick,
  Player,
  RevealMode,
  RoleDef,
  Settings,
} from './types';

export class GameError extends Error {}

/** Random id that also works on plain-http pages, where crypto.randomUUID is unavailable. */
function randomUUID(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

type Rng = () => number;

function fail(message: string): never {
  throw new GameError(message);
}

export function createGame(): Game {
  return {
    phase: 'SETUP',
    players: [],
    roles: PRESET_ROLES.map((r) => ({ ...r })),
    roleCounts: { mafia: 1, police: 1, doctor: 1, farmer: 2, bomber: 0 },
    settings: { ...DEFAULT_SETTINGS },
    round: 1,
    nightPicks: {},
    lastProtected: {},
    selfSavesUsed: {},
    investigations: {},
    morning: null,
    vote: null,
    voteResult: null,
    winner: null,
    soloWinnerId: null,
    discussionEndsAt: null,
    log: [],
    deathCause: {},
    readyToVote: [],
    autoAdvanceAt: null,
    storyId: null,
    nextStoryId: null,
  };
}

// ---------- helpers ----------

export function getPlayer(game: Game, id: string): Player {
  return game.players.find((p) => p.id === id) ?? fail('Unknown player.');
}

export function roleOf(game: Game, player: Player): RoleDef | null {
  return game.roles.find((r) => r.id === player.roleId) ?? null;
}

function alive(game: Game): Player[] {
  return game.players.filter((p) => p.alive);
}

function nameOf(game: Game, id: string): string {
  return game.players.find((p) => p.id === id)?.name ?? '?';
}

/** How much a dead player's death reveals, depending on whether they died at night or by vote. */
export function revealModeFor(game: Game, id: string): RevealMode {
  return game.deathCause[id] === 'day' ? game.settings.revealDayDeath : game.settings.revealNightDeath;
}

function nameWithRole(game: Game, id: string): string {
  const p = getPlayer(game, id);
  const role = roleOf(game, p);
  switch (revealModeFor(game, id)) {
    case 'role':
      return role ? `${p.name} (${role.name})` : p.name;
    case 'team':
      return `${p.name} (${role?.team === 'mafia' ? 'mafia' : 'not mafia'})`;
    case 'none':
      return p.name;
  }
}

/** When a results screen should move on by itself, or null if the host clicks next. */
function autoAdvanceTime(game: Game, now: number): number | null {
  const secs = game.settings.autoAdvanceSeconds;
  return secs > 0 ? now + secs * 1000 : null;
}

function requirePhase(game: Game, ...phases: Game['phase'][]) {
  if (!phases.includes(game.phase)) fail(`Not allowed during ${game.phase}.`);
}

function shuffle<T>(items: T[], rng: Rng): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---------- setup & claiming ----------

export interface SetupPayload {
  names: string[];
  roles: RoleDef[];
  roleCounts: Record<string, number>;
  settings: Settings;
}

export function configure(game: Game, input: SetupPayload) {
  requirePhase(game, 'SETUP', 'CLAIMING');
  const errors = validateSetup(input);
  if (errors.length) fail(errors.join(' '));

  const names = input.names.map((n) => n.trim()).filter(Boolean);
  // Keep ids and claims for names that were already there.
  game.players = names.map((name) => {
    const existing = game.players.find((p) => p.name.toLowerCase() === name.toLowerCase());
    return existing
      ? { ...existing, name }
      : { id: randomUUID().slice(0, 8), name, roleId: null, alive: true, token: null, ackedRole: false };
  });
  game.roles = input.roles.map((r) => ({ ...r, name: r.name.trim() }));
  game.roleCounts = Object.fromEntries(game.roles.map((r) => [r.id, input.roleCounts[r.id] ?? 0]));
  game.settings = { ...DEFAULT_SETTINGS, ...input.settings };
  game.storyId = pickStory(game);
  game.nextStoryId = null;
  game.phase = 'CLAIMING';
}

export function backToSetup(game: Game) {
  requirePhase(game, 'CLAIMING');
  game.phase = 'SETUP';
}

export function claim(game: Game, playerId: string): string {
  if (game.phase === 'SETUP') fail('The game is not set up yet.');
  const p = getPlayer(game, playerId);
  if (p.token) fail(`${p.name} has already been claimed.`);
  p.token = randomUUID();
  return p.token;
}

export function resume(game: Game, token: string): string | null {
  return game.players.find((p) => p.token && p.token === token)?.id ?? null;
}

export function releaseClaim(game: Game, playerId: string) {
  getPlayer(game, playerId).token = null;
}

export function startGame(game: Game, rng: Rng = Math.random) {
  requirePhase(game, 'CLAIMING', 'GAME_OVER');
  const unclaimed = game.players.filter((p) => !p.token);
  if (unclaimed.length) fail(`Waiting for: ${unclaimed.map((p) => p.name).join(', ')}.`);

  const deck = game.roles.flatMap((r) => Array<string>(game.roleCounts[r.id] ?? 0).fill(r.id));
  if (deck.length !== game.players.length) fail('Role counts do not match the number of players.');
  const dealt = shuffle(deck, rng);
  game.players.forEach((p, i) => {
    p.roleId = dealt[i];
    p.alive = true;
    p.ackedRole = false;
  });

  Object.assign(game, {
    phase: 'ROLE_REVEAL',
    round: 1,
    nightPicks: {},
    lastProtected: {},
    selfSavesUsed: {},
    investigations: {},
    morning: null,
    vote: null,
    voteResult: null,
    winner: null,
    soloWinnerId: null,
    discussionEndsAt: null,
    log: [],
    deathCause: {},
    readyToVote: [],
    autoAdvanceAt: null,
    // Chosen ahead of time (at setup, or at the end of the last game) so the host can
    // prepare the narrator's voice lines before the game starts.
    storyId: game.nextStoryId ?? game.storyId ?? pickStory(game, rng),
    nextStoryId: null,
  } satisfies Partial<Game>);
}

function pickStory(game: Game, rng: Rng = Math.random): string {
  const fixed = STORIES.find((st) => st.id === game.settings.story);
  if (fixed) return fixed.id;
  const others = STORIES.filter((st) => st.id !== game.storyId);
  return others[Math.floor(rng() * others.length)].id;
}

function endGame(game: Game) {
  game.phase = 'GAME_OVER';
  game.nextStoryId = pickStory(game);
}

/** Once everyone has seen their role, the night starts by itself after a short pause. */
export function ackRole(game: Game, playerId: string, now = Date.now()) {
  getPlayer(game, playerId).ackedRole = true;
  if (game.phase === 'ROLE_REVEAL' && game.players.every((p) => p.ackedRole)) game.autoAdvanceAt = now + 3000;
}

/** Back to the setup screen with the same names and roles, clearing all claims. */
export function resetGame(game: Game) {
  const fresh = createGame();
  Object.assign(game, fresh, {
    roles: game.roles,
    roleCounts: game.roleCounts,
    settings: game.settings,
    players: game.players.map((p) => ({ ...p, roleId: null, alive: true, token: null, ackedRole: false })),
  });
}

// ---------- night ----------

export function nightKind(game: Game, player: Player): NightActionKind | null {
  const ability = roleOf(game, player)?.ability ?? 'none';
  return ability === 'none' ? null : ability;
}

export const SUSPECT_PROMPT = 'Who do you suspect is mafia?';

export function nightPrompt(kind: NightActionKind): string {
  switch (kind) {
    case 'kill':
      return 'Choose who to kill tonight.';
    case 'protect':
      return 'Choose who to save tonight.';
    case 'investigate':
      return 'Choose who to investigate.';
  }
}

export function validTargets(game: Game, player: Player): string[] {
  const kind = nightKind(game, player);
  const others = alive(game).filter((p) => p.id !== player.id);
  if (!kind) return [];
  if (kind === 'kill') {
    const myTeam = teamOf(player, game.roles);
    return others.filter((p) => myTeam !== 'mafia' || teamOf(p, game.roles) !== 'mafia').map((p) => p.id);
  }
  if (kind === 'protect') {
    const { doctorSelfSave, doctorNoRepeat } = game.settings;
    const canSelf =
      doctorSelfSave === 'always' ||
      (doctorSelfSave === 'once' && (game.selfSavesUsed[player.id] ?? 0) < 1);
    const pool = canSelf ? alive(game) : others;
    const last = game.lastProtected[player.id];
    return pool.filter((p) => !(doctorNoRepeat && p.id === last)).map((p) => p.id);
  }
  // Police working together already know each other; investigating a teammate would also
  // deadlock the group, since that teammate can't pick themselves.
  const team = new Set(groupMembers(game, player).map((p) => p.id));
  return others.filter((p) => !team.has(p.id)).map((p) => p.id);
}

/** Whether players with this role pick one shared target at night. */
export function actsAsGroup(game: Game, role: RoleDef): boolean {
  if (role.ability === 'none') return false;
  return role.actsAsGroup || (role.ability === 'investigate' && game.settings.policeTogether);
}

export function groupMembers(game: Game, player: Player): Player[] {
  const role = roleOf(game, player);
  if (!role || !actsAsGroup(game, role)) return [player];
  return alive(game).filter((p) => p.roleId === role.id);
}

export interface GroupDecision {
  targetId: string | null;
  settled: boolean;
  status: string;
}

export function groupDecision(game: Game, members: Player[]): GroupDecision {
  const picks = members.map((m) => game.nightPicks[m.id] ?? { targetId: null, confirmed: false, suspectId: null });
  const confirmed = picks.filter((p) => p.confirmed && p.targetId).map((p) => p.targetId!);
  const waiting = members.length - confirmed.length;
  const waitingMsg = `Waiting for ${waiting} of ${members.length} to confirm.`;
  const consensus = members.length === 1 ? 'unanimous' : game.settings.groupConsensus;

  if (consensus === 'majority') {
    const counts = new Map<string, number>();
    for (const t of confirmed) counts.set(t, (counts.get(t) ?? 0) + 1);
    for (const [t, c] of counts) {
      if (c > members.length / 2) return { targetId: t, settled: true, status: `Agreed on ${nameOf(game, t)}.` };
    }
    return { targetId: null, settled: false, status: waiting ? waitingMsg : 'No majority yet. Change your picks.' };
  }

  // 'first' propagates the first confirmation to everyone, so it settles like unanimous.
  if (waiting) return { targetId: null, settled: false, status: waitingMsg };
  if (new Set(confirmed).size === 1) {
    return { targetId: confirmed[0], settled: true, status: `Agreed on ${nameOf(game, confirmed[0])}.` };
  }
  return { targetId: null, settled: false, status: 'You must all pick the same person.' };
}

export function startNight(game: Game) {
  requirePhase(game, 'ROLE_REVEAL', 'VOTE_RESULT');
  if (game.phase === 'VOTE_RESULT') game.round += 1;
  game.phase = 'NIGHT';
  game.vote = null;
  game.discussionEndsAt = null;
  // Players without a night action start "confirmed"; they only owe a suspicion.
  game.nightPicks = Object.fromEntries(
    alive(game).map((p) => [p.id, { targetId: null, confirmed: !nightKind(game, p), suspectId: null }]),
  );
}

/**
 * Upgrades a saved game from before everyone answered "who do you suspect?". Back then roles
 * without an action stored their suspicion as their night pick.
 */
export function migrateGame(game: Game) {
  // Saves from before reveal modes, auto-advance and stories.
  // A game in progress keeps its old rules; otherwise the new defaults apply.
  const legacy = game.settings as Settings & { revealRoleOnDeath?: boolean };
  const inProgress = !['SETUP', 'CLAIMING', 'GAME_OVER'].includes(game.phase);
  if (!legacy.revealNightDeath) {
    const old = legacy.revealRoleOnDeath === false ? 'none' : 'role';
    Object.assign(
      game.settings,
      inProgress
        ? { revealNightDeath: old, revealDayDeath: old }
        : { revealNightDeath: DEFAULT_SETTINGS.revealNightDeath, revealDayDeath: DEFAULT_SETTINGS.revealDayDeath },
    );
    delete legacy.revealRoleOnDeath;
  }
  game.settings.autoAdvanceSeconds ??= inProgress ? 0 : DEFAULT_SETTINGS.autoAdvanceSeconds;
  game.settings.story ??= DEFAULT_SETTINGS.story;
  game.settings.policeTogether ??= inProgress ? false : DEFAULT_SETTINGS.policeTogether;
  game.deathCause ??= {};
  game.readyToVote ??= [];
  game.autoAdvanceAt ??= null;
  game.storyId ??= null;
  game.nextStoryId ??= null;
  game.soloWinnerId ??= null;
  // Offer roles added since the game was set up (e.g. the suicide bomber), with a count of 0.
  for (const preset of PRESET_ROLES) {
    if (game.roles.some((r) => r.id === preset.id)) continue;
    game.roles.push({ ...preset });
    game.roleCounts[preset.id] = 0;
  }

  for (const [id, pick] of Object.entries(game.nightPicks as Record<string, Partial<NightPick>>)) {
    if (pick.suspectId !== undefined) continue;
    const player = getPlayer(game, id);
    if (nightKind(game, player)) {
      pick.suspectId = null;
    } else {
      Object.assign(pick, { suspectId: pick.confirmed ? pick.targetId : null, targetId: null, confirmed: true });
    }
  }
}

export function setNightPick(game: Game, playerId: string, targetId: string | null) {
  requirePhase(game, 'NIGHT');
  const player = getPlayer(game, playerId);
  const pick = game.nightPicks[playerId] ?? fail('You have no action tonight.');
  if (!nightKind(game, player)) fail('You have no action tonight.');
  if (targetId !== null && !validTargets(game, player).includes(targetId)) fail('You cannot choose that player.');
  pick.targetId = targetId;
  pick.confirmed = false;
}

/** Returns true if this confirmation completed the night (and it was resolved). */
export function confirmNight(game: Game, playerId: string): boolean {
  requirePhase(game, 'NIGHT');
  const player = getPlayer(game, playerId);
  const pick = game.nightPicks[playerId] ?? fail('You have no action tonight.');
  if (!nightKind(game, player)) fail('You have no action tonight.');
  if (!pick.targetId) fail('Pick someone first.');
  pick.confirmed = true;

  const members = groupMembers(game, player);
  if (members.length > 1 && game.settings.groupConsensus === 'first') {
    for (const m of members) Object.assign(game.nightPicks[m.id], { targetId: pick.targetId, confirmed: true });
  }
  return resolveIfComplete(game);
}

export function suspectTargets(game: Game, player: Player): string[] {
  return alive(game)
    .filter((p) => p.id !== player.id)
    .map((p) => p.id);
}

/** Sets this player's answer to "who do you suspect?". Can be changed until the night ends. */
export function setSuspect(game: Game, playerId: string, targetId: string): boolean {
  requirePhase(game, 'NIGHT');
  const pick = game.nightPicks[playerId] ?? fail('You have no action tonight.');
  if (!suspectTargets(game, getPlayer(game, playerId)).includes(targetId)) fail('You cannot choose that player.');
  pick.suspectId = targetId;
  return resolveIfComplete(game);
}

function resolveIfComplete(game: Game): boolean {
  if (!nightComplete(game)) return false;
  resolveNight(game);
  return true;
}

export function nightProgress(game: Game): { done: number; total: number } {
  const picks = Object.values(game.nightPicks);
  return { done: picks.filter((p) => p.confirmed && p.suspectId).length, total: picks.length };
}

export function nightComplete(game: Game): boolean {
  const { done, total } = nightProgress(game);
  if (done < total) return false;
  const seen = new Set<string>();
  for (const p of alive(game)) {
    const members = groupMembers(game, p);
    if (members.length < 2 || seen.has(p.roleId!)) continue;
    seen.add(p.roleId!);
    if (!groupDecision(game, members).settled) return false;
  }
  return true;
}

/** Applies all night actions. `force` lets the host end a stuck night using unconfirmed picks. */
export function resolveNight(game: Game, force = false, now = Date.now()) {
  requirePhase(game, 'NIGHT');
  const usable = (id: string) => {
    const pick = game.nightPicks[id];
    return pick && (pick.confirmed || force) ? pick.targetId : null;
  };

  const kills = new Set<string>();
  const protectedIds = new Set<string>();
  const suspicions: Record<string, number> = {};
  const handledGroups = new Set<string>();

  for (const pick of Object.values(game.nightPicks)) {
    if (pick.suspectId) suspicions[pick.suspectId] = (suspicions[pick.suspectId] ?? 0) + 1;
  }

  for (const p of alive(game)) {
    const kind = nightKind(game, p);
    if (!kind) continue;
    const members = groupMembers(game, p);
    let actors = [p];
    let target: string | null;
    if (members.length > 1) {
      if (handledGroups.has(p.roleId!)) continue;
      handledGroups.add(p.roleId!);
      actors = members;
      target = groupDecision(game, members).targetId;
    } else {
      target = usable(p.id);
    }

    for (const actor of actors) {
      if (kind === 'protect') {
        if (target) game.lastProtected[actor.id] = target;
        else delete game.lastProtected[actor.id];
        if (target === actor.id) game.selfSavesUsed[actor.id] = (game.selfSavesUsed[actor.id] ?? 0) + 1;
      }
      if (kind === 'investigate' && target) {
        (game.investigations[actor.id] ??= []).push({
          night: game.round,
          targetId: target,
          isMafia: teamOf(getPlayer(game, target), game.roles) === 'mafia',
        });
      }
    }
    if (!target) continue;
    if (kind === 'kill') kills.add(target);
    if (kind === 'protect') protectedIds.add(target);
  }

  const killedIds = [...kills].filter((id) => !protectedIds.has(id));
  for (const id of killedIds) {
    getPlayer(game, id).alive = false;
    game.deathCause[id] = 'night';
  }

  game.morning = { night: game.round, killedIds, suspicions };
  game.log.push(
    killedIds.length
      ? `Night ${game.round}: ${killedIds.map((id) => nameWithRole(game, id)).join(', ')} killed.`
      : `Night ${game.round}: nobody died.`,
  );
  game.nightPicks = {};
  game.winner = checkWinner(game.players, game.roles);
  game.phase = 'MORNING';
  game.autoAdvanceAt = autoAdvanceTime(game, now);
}

// ---------- day ----------

export function startDiscussion(game: Game, now = Date.now()) {
  requirePhase(game, 'MORNING');
  game.phase = 'DAY_DISCUSSION';
  const secs = game.settings.discussionSeconds;
  game.discussionEndsAt = secs > 0 ? now + secs * 1000 : null;
  // The vote starts when the discussion timer runs out, or when everyone is ready.
  game.autoAdvanceAt = game.discussionEndsAt;
  game.readyToVote = [];
}

/** A living player says they're ready to vote; the vote starts once everyone alive is ready. */
export function setReadyToVote(game: Game, playerId: string, ready: boolean) {
  requirePhase(game, 'DAY_DISCUSSION');
  if (!getPlayer(game, playerId).alive) fail('Dead players cannot vote.');
  game.readyToVote = game.readyToVote.filter((id) => id !== playerId);
  if (ready) game.readyToVote.push(playerId);
  if (alive(game).every((p) => game.readyToVote.includes(p.id))) startVote(game);
}

export function startVote(game: Game) {
  requirePhase(game, 'DAY_DISCUSSION');
  game.phase = 'DAY_VOTE';
  game.discussionEndsAt = null;
  game.autoAdvanceAt = null;
  game.readyToVote = [];
  game.voteResult = null;
  game.vote = { candidates: alive(game).map((p) => p.id), votes: {}, isRevote: false };
}

export function castVote(game: Game, voterId: string, ballot: Ballot, now = Date.now()) {
  requirePhase(game, 'DAY_VOTE');
  const voter = getPlayer(game, voterId);
  const vote = game.vote!;
  if (!voter.alive) fail('Dead players cannot vote.');
  if (ballot !== 'skip' && (!vote.candidates.includes(ballot) || ballot === voterId)) fail('You cannot vote for that player.');
  vote.votes[voterId] = ballot;
  if (alive(game).every((p) => vote.votes[p.id])) closeVote(game, now);
}

/**
 * Plurality wins: the candidate with the most votes is eliminated, unless "skip" has at
 * least as many votes or several candidates tie for the lead.
 */
export function closeVote(game: Game, now = Date.now()) {
  requirePhase(game, 'DAY_VOTE');
  const vote = game.vote!;
  const tally: Record<string, number> = {};
  let skips = 0;
  for (const ballot of Object.values(vote.votes)) {
    if (ballot === 'skip') skips++;
    else tally[ballot] = (tally[ballot] ?? 0) + 1;
  }
  const top = Math.max(0, ...Object.values(tally));
  const leaders = Object.keys(tally).filter((id) => tally[id] === top);
  const tie = top > 0 && leaders.length > 1 && top > skips;
  const eliminatedId = top > skips && leaders.length === 1 ? leaders[0] : null;
  game.voteResult = { tally, ballots: { ...vote.votes }, eliminatedId, tie };

  if (tie && game.settings.tieRule === 'revote' && !vote.isRevote) {
    game.vote = { candidates: leaders, votes: {}, isRevote: true };
    game.log.push(`Day ${game.round}: tie between ${leaders.map((id) => nameOf(game, id)).join(' and ')}. Revote.`);
    return;
  }

  if (eliminatedId) {
    const out = getPlayer(game, eliminatedId);
    out.alive = false;
    game.deathCause[eliminatedId] = 'day';
    game.log.push(`Day ${game.round}: ${nameWithRole(game, eliminatedId)} voted out.`);
  } else {
    game.log.push(`Day ${game.round}: nobody was voted out.`);
  }
  game.vote = null;
  const bomber = eliminatedId && roleOf(game, getPlayer(game, eliminatedId))?.winsWhenVotedOut;
  if (bomber) {
    // The town fell for it: the bomber wins alone and everyone else loses.
    game.winner = roleOf(game, getPlayer(game, eliminatedId))!.team;
    game.soloWinnerId = eliminatedId;
    game.log.push(`${nameOf(game, eliminatedId)} was the ${roleOf(game, getPlayer(game, eliminatedId))!.name} and wins alone.`);
  } else {
    game.winner = checkWinner(game.players, game.roles);
  }
  game.phase = 'VOTE_RESULT';
  game.autoAdvanceAt = autoAdvanceTime(game, now);
}

/** The host's single "next" button. */
export function advance(game: Game, now = Date.now()) {
  game.autoAdvanceAt = null;
  switch (game.phase) {
    case 'ROLE_REVEAL':
      return startNight(game);
    case 'MORNING':
      if (game.winner) return endGame(game);
      return startDiscussion(game, now);
    case 'DAY_DISCUSSION':
      return startVote(game);
    case 'DAY_VOTE':
      return closeVote(game, now);
    case 'VOTE_RESULT':
      if (game.winner) return endGame(game);
      return startNight(game);
    default:
      fail(`Nothing to advance during ${game.phase}.`);
  }
}

/** Runs a scheduled automatic step if it is due. Returns true if the game changed. */
export function tick(game: Game, now = Date.now()): boolean {
  if (game.autoAdvanceAt === null || now < game.autoAdvanceAt) return false;
  advance(game, now);
  return true;
}
