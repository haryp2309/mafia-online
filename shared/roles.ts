import type { RoleDef, Settings } from './types';

export const PRESET_ROLES: RoleDef[] = [
  {
    id: 'mafia',
    name: 'Mafia',
    team: 'mafia',
    ability: 'kill',
    actsAsGroup: true,
    description: 'Each night, agree with your fellow mafia on one person to kill. Win when you equal or outnumber the town.',
  },
  {
    id: 'police',
    name: 'Police',
    team: 'town',
    ability: 'investigate',
    actsAsGroup: false,
    description: 'Each night, investigate one person to learn whether they are mafia.',
  },
  {
    id: 'doctor',
    name: 'Doctor',
    team: 'town',
    ability: 'protect',
    actsAsGroup: false,
    description: 'Each night, choose one person to save. If the mafia targets them, they survive.',
  },
  {
    id: 'farmer',
    name: 'Farmer',
    team: 'town',
    ability: 'none',
    actsAsGroup: false,
    description: 'An honest villager. Find the mafia and vote them out during the day.',
  },
  {
    id: 'bomber',
    name: 'Suicide Bomber',
    team: 'neutral',
    ability: 'none',
    actsAsGroup: false,
    winsWhenVotedOut: true,
    description:
      "You are on your own. Get the town to vote you out during the day and you win alone; everyone else loses. Don't be too obvious. If the mafia kills you at night, you simply die.",
  },
];

export const DEFAULT_SETTINGS: Settings = {
  revealNightDeath: 'role',
  revealDayDeath: 'team',
  autoAdvanceSeconds: 10,
  story: 'random',
  groupConsensus: 'unanimous',
  policeTogether: true,
  doctorSelfSave: 'once',
  doctorNoRepeat: false,
  tieRule: 'noElimination',
  deadSeeRoles: false,
  discussionSeconds: 0,
};

/** A sensible role mix for a player count. Anything left over becomes farmers. */
export function suggestCounts(playerCount: number): Record<string, number> {
  const mafia = Math.max(1, Math.floor(playerCount / 4));
  const police = playerCount >= 5 ? 1 : 0;
  const doctor = playerCount >= 4 ? 1 : 0;
  const farmer = Math.max(0, playerCount - mafia - police - doctor);
  return { mafia, police, doctor, farmer };
}
