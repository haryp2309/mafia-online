import { useEffect, useRef } from 'react';
import { getStory, storyLine, type Story } from '../../../shared/stories';
import type { PublicState } from '../../../shared/types';
import { playerName, roleName } from '../ui';
import { startNightAmbience, sting, stopNightAmbience } from './audio';
import { narrator, splitPhrases } from './voice';

// ---------- the lines ----------

const line = {
  intro: (story: Story) =>
    `${story.title}. ${story.intro} Now… look at your phone, and learn who you really are. Tell no one.`,
  night: (story: Story, r: number) => `${storyLine(story.night, r)} Night ${r}. Close your eyes… only your phone may see you now.`,
  quiet: (story: Story, r: number) => `Wake up. ${storyLine(story.quiet, r)}`,
  death: (story: Story, index: number, name: string, reveal: string) => `${storyLine(story.death, index, name)} ${reveal}`,
  discussion: 'Talk. Accuse. Lie, if you must. When you are ready to vote, tell your phone.',
  vote: 'The time for talk is over. Cast your vote.',
  revote: (names: string[]) => `A tie. Choose again… between ${names.join(' and ')}.`,
  voteOut: (story: Story, r: number, name: string, reveal: string) => `${storyLine(story.voteOut, r, name)} ${reveal}`,
  noVote: (story: Story, r: number) => storyLine(story.noVote, r),
  bomber: (name: string) =>
    `${name} smiles… and opens their coat. ${name} was the suicide bomber. You voted exactly as they wanted. Nobody walks away from this one.`,
  soloWin: (name: string) => `${name} wins alone. Everyone else… loses.`,
};

const REVEAL = {
  role: (role: string) => `They were… a ${role}.`,
  mafia: 'They were… one of the mafia.',
  notMafia: 'They were… not mafia.',
  secret: 'Their secret dies with them.',
};

/** The narrator's line about what a death reveals, matching the game's reveal setting. */
function revealLine(pub: PublicState, id: string): string {
  const p = pub.players.find((x) => x.id === id);
  const role = roleName(pub, p?.roleId);
  if (role) return REVEAL.role(role);
  if (p?.isMafia !== undefined) return p.isMafia ? REVEAL.mafia : REVEAL.notMafia;
  return REVEAL.secret;
}

export function narrationFor(pub: PublicState): string {
  const story = getStory(pub.storyId);
  const r = pub.round;
  switch (pub.phase) {
    case 'ROLE_REVEAL':
      return line.intro(story);
    case 'NIGHT':
      return line.night(story, r);
    case 'MORNING': {
      const killed = pub.morning?.killedIds ?? [];
      if (!killed.length) return line.quiet(story, r);
      return `Wake up. ${killed.map((id, i) => line.death(story, r + i, playerName(pub, id), revealLine(pub, id))).join(' ')}`;
    }
    case 'DAY_DISCUSSION':
      return line.discussion;
    case 'DAY_VOTE':
      return pub.vote?.isRevote ? line.revote(pub.vote.candidates.map((id) => playerName(pub, id))) : line.vote;
    case 'VOTE_RESULT': {
      const id = pub.voteResult?.eliminatedId;
      if (id && id === pub.soloWinnerId) return line.bomber(playerName(pub, id));
      return id ? line.voteOut(story, r, playerName(pub, id), revealLine(pub, id)) : line.noVote(story, r);
    }
    case 'GAME_OVER':
      if (pub.soloWinnerId) return line.soloWin(playerName(pub, pub.soloWinnerId));
      return pub.winner === 'mafia' ? story.mafiaWins : story.townWins;
    default:
      return '';
  }
}

/**
 * Every phrase the narrator could say in this game, most urgent first: this round's lines
 * (for players still alive) before later rounds, so the voice is ready when it's needed.
 * Called again as the game moves on; each call re-orders what's left to prepare.
 */
export function allPhrases(pub: PublicState): string[] {
  const nextGame = pub.phase === 'GAME_OVER';
  const storyId = nextGame ? (pub.nextStoryId ?? pub.storyId) : pub.storyId;
  if (!storyId || !pub.players.length) return [];
  const story = getStory(storyId);
  const alive = pub.players.filter((p) => nextGame || p.alive).map((p) => p.name);
  const inGame = pub.roles.filter((r) => (pub.roleCounts[r.id] ?? 0) > 0);
  const reveals = (mode: string) =>
    mode === 'role' ? inGame.map((r) => REVEAL.role(r.name)) : mode === 'team' ? [REVEAL.mafia, REVEAL.notMafia] : [REVEAL.secret];
  const hasBomber = inGame.some((r) => r.winsWhenVotedOut);
  const startRound = nextGame || ['SETUP', 'CLAIMING', 'ROLE_REVEAL'].includes(pub.phase) ? 1 : pub.round;
  // The game can't outlast its players: each round removes at least the mafia's victim.
  const lastRound = startRound + Math.max(1, alive.length - 1);

  const texts: string[] = [];
  if (startRound === 1) texts.push(line.intro(story));
  for (let r = startRound; r <= lastRound; r++) {
    texts.push(line.night(story, r), line.quiet(story, r));
    for (const name of alive) texts.push(line.death(story, r, name, ''));
    if (r === startRound) texts.push(...reveals(pub.settings.revealNightDeath), line.discussion, line.vote);
    for (const name of alive) texts.push(line.voteOut(story, r, name, ''));
    if (r === startRound) {
      texts.push(...reveals(pub.settings.revealDayDeath));
      if (hasBomber) for (const name of alive) texts.push(line.bomber(name), line.soloWin(name));
      texts.push(story.townWins, story.mafiaWins);
    }
    texts.push(line.noVote(story, r));
  }
  return [...new Set(texts.flatMap(splitPhrases))];
}

/** Reads each new phase aloud and sets the mood. Skips whatever phase the page loaded into. */
export function useNarration(pub: PublicState | undefined, enabled: boolean) {
  const lastKey = useRef<string | null>(null);
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  const key = pub ? `${pub.phase}:${pub.round}:${pub.vote?.isRevote ?? ''}` : null;

  // Prepare this game's voice lines in the background as soon as names and story are known.
  // Re-prioritise whenever the round, story, cast or alive players change.
  const prepKey = pub
    ? `${pub.phase === 'SETUP'}|${pub.phase === 'GAME_OVER'}|${pub.round}|${pub.storyId}|${pub.nextStoryId}|${pub.players.map((p) => `${p.name}:${p.alive}`).join(',')}|${JSON.stringify(pub.roleCounts)}`
    : '';
  useEffect(() => {
    if (pub && enabled && pub.phase !== 'SETUP') narrator.prepare(allPhrases(pub));
    // Only re-run when what the narrator needs to say changes, not on every state update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prepKey, enabled]);

  useEffect(() => {
    if (!pub || !key || key === lastKey.current) return;
    const first = lastKey.current === null;
    lastKey.current = key;

    if (enabled && pub.phase === 'NIGHT') startNightAmbience();
    else stopNightAmbience();

    if (first || !enabled) return;
    const deaths =
      (pub.phase === 'MORNING' && (pub.morning?.killedIds.length ?? 0) > 0) ||
      (pub.phase === 'VOTE_RESULT' && !!pub.voteResult?.eliminatedId) ||
      pub.phase === 'GAME_OVER';
    if (deaths) sting();
    // Let the boom land before the voice starts. Kept in a ref so a state update that
    // doesn't change the phase can't cancel it.
    if (pending.current) clearTimeout(pending.current);
    const text = narrationFor(pub);
    pending.current = setTimeout(() => narrator.speak(text), deaths ? 1200 : 0);
  }, [key, enabled, pub]);

  useEffect(() => {
    if (!enabled) {
      if (pending.current) clearTimeout(pending.current);
      stopNightAmbience();
      narrator.stop();
    }
  }, [enabled]);

  // Some browsers keep talking after a reload; make sure a closed page goes quiet.
  useEffect(() => {
    const quiet = () => narrator.stop();
    window.addEventListener('pagehide', quiet);
    return () => window.removeEventListener('pagehide', quiet);
  }, []);
}
