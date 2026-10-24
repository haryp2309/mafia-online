import type { ClientState, Game, PrivateNight, PrivateState, PublicState } from './types';
import {
  actsAsGroup,
  getPlayer,
  groupDecision,
  groupMembers,
  nightKind,
  nightProgress,
  nightPrompt,
  revealModeFor,
  roleOf,
  SUSPECT_PROMPT,
  suspectTargets,
  validTargets,
} from './game';

/**
 * Everything any device may see. Roles appear only once they are public:
 * dead players when roles are revealed on death, and everyone at game over.
 */
export function publicView(game: Game, connected: (id: string) => boolean, build = ''): PublicState {
  const over = game.phase === 'GAME_OVER';
  const inGame = !['SETUP', 'CLAIMING'].includes(game.phase);
  const alive = game.players.filter((p) => p.alive);
  return {
    phase: game.phase,
    round: game.round,
    players: game.players.map((p) => {
      const reveal = over ? 'role' : p.alive ? 'none' : revealModeFor(game, p.id);
      const role = roleOf(game, p);
      return {
        id: p.id,
        name: p.name,
        alive: p.alive,
        claimed: !!p.token,
        connected: connected(p.id),
        ...(reveal === 'role' && role ? { roleId: role.id } : {}),
        ...(reveal === 'team' && role ? { isMafia: role.team === 'mafia' } : {}),
      };
    }),
    roles: game.roles,
    roleCounts: game.roleCounts,
    settings: game.settings,
    morning: game.morning,
    voteResult: game.voteResult,
    vote: game.vote && {
      candidates: game.vote.candidates,
      votedCount: Object.keys(game.vote.votes).length,
      voterCount: alive.length,
      isRevote: game.vote.isRevote,
    },
    nightProgress: game.phase === 'NIGHT' ? nightProgress(game) : null,
    roleAcks:
      inGame && game.phase === 'ROLE_REVEAL'
        ? { done: game.players.filter((p) => p.ackedRole).length, total: game.players.length }
        : null,
    winner: game.winner,
    soloWinnerId: game.soloWinnerId,
    discussionEndsAt: game.discussionEndsAt,
    log: game.log,
    ready:
      game.phase === 'DAY_DISCUSSION' ? { done: game.readyToVote.length, total: alive.length } : null,
    autoAdvanceAt: game.autoAdvanceAt,
    storyId: game.storyId,
    nextStoryId: game.nextStoryId,
    serverNow: Date.now(),
    build,
  };
}

/** The secrets a single player is allowed to know. */
export function privateView(game: Game, playerId: string): PrivateState | null {
  const player = getPlayer(game, playerId);
  const role = roleOf(game, player);
  if (!role) return null;

  // Mafia know each other; group roles (e.g. police acting together) know each other too.
  const teammates = game.players
    .filter((p) => p.id !== player.id)
    .filter((p) => {
      const r = roleOf(game, p);
      if (!r) return false;
      if (role.team === 'mafia') return r.team === 'mafia';
      return actsAsGroup(game, role) && r.id === role.id;
    })
    .map((p) => ({ id: p.id, name: p.name, roleName: roleOf(game, p)!.name }));

  let night: PrivateNight | null = null;
  const pick = game.nightPicks[player.id];
  if (game.phase === 'NIGHT' && player.alive && pick) {
    const kind = nightKind(game, player);
    const members = groupMembers(game, player);
    night = {
      suspect: { prompt: SUSPECT_PROMPT, validTargets: suspectTargets(game, player), pick: pick.suspectId ?? null },
      kind,
      prompt: kind && nightPrompt(kind),
      validTargets: validTargets(game, player),
      pick: pick.targetId,
      confirmed: pick.confirmed,
    };
    if (kind && members.length > 1) {
      night.group = members.map((m) => ({
        playerId: m.id,
        name: m.name,
        targetId: game.nightPicks[m.id]?.targetId ?? null,
        confirmed: game.nightPicks[m.id]?.confirmed ?? false,
      }));
      const decision = groupDecision(game, members);
      night.groupStatus = decision.status;
      night.groupSettled = decision.settled;
    }
  }

  const seesAll = !player.alive && game.settings.deadSeeRoles;
  return {
    playerId: player.id,
    name: player.name,
    role,
    teammates,
    ackedRole: player.ackedRole,
    night,
    investigations: game.investigations[player.id] ?? [],
    myVote: game.vote?.votes[player.id] ?? null,
    readyToVote: game.readyToVote.includes(player.id),
    ...(seesAll
      ? { allRoles: Object.fromEntries(game.players.map((p) => [p.id, roleOf(game, p)?.name ?? '?'])) }
      : {}),
  };
}

export function clientView(
  game: Game,
  playerId: string | null,
  connected: (id: string) => boolean,
  build = '',
): ClientState {
  const you = game.players.find((p) => p.id === playerId);
  return {
    public: publicView(game, connected, build),
    you: you ? { id: you.id, name: you.name } : null,
    me: you ? privateView(game, you.id) : null,
  };
}
