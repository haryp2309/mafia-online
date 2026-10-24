export type Team = 'mafia' | 'town' | 'neutral';
export type Ability = 'none' | 'kill' | 'protect' | 'investigate';
/** A role's night action. Roles with ability 'none' have no action, only the suspicion question. */
export type NightActionKind = Exclude<Ability, 'none'>;

export interface RoleDef {
  id: string;
  name: string;
  team: Team;
  ability: Ability;
  /** Members of this role pick one shared target (e.g. mafia). */
  actsAsGroup: boolean;
  description: string;
  /** Wins alone, and everyone else loses, if voted out during the day (the suicide bomber). */
  winsWhenVotedOut?: boolean;
}

export type Consensus = 'unanimous' | 'majority' | 'first';
export type DoctorSelfSave = 'never' | 'once' | 'always';
export type TieRule = 'noElimination' | 'revote';
/** What is announced about a dead player: their role, only whether they were mafia, or nothing. */
export type RevealMode = 'role' | 'team' | 'none';

export interface Settings {
  revealNightDeath: RevealMode;
  revealDayDeath: RevealMode;
  /** Seconds before the morning and vote result move on by themselves. 0 = host clicks next. */
  autoAdvanceSeconds: number;
  /** A story id, or 'random'. */
  story: string;
  /** How a group (e.g. mafia) settles on its target. */
  groupConsensus: Consensus;
  /** Roles that investigate (police) pick one shared target, like the mafia. */
  policeTogether: boolean;
  doctorSelfSave: DoctorSelfSave;
  /** Doctor cannot protect the same person two nights in a row. */
  doctorNoRepeat: boolean;
  tieRule: TieRule;
  deadSeeRoles: boolean;
  /** 0 = no timer. */
  discussionSeconds: number;
}

export type Phase =
  | 'SETUP'
  | 'CLAIMING'
  | 'ROLE_REVEAL'
  | 'NIGHT'
  | 'MORNING'
  | 'DAY_DISCUSSION'
  | 'DAY_VOTE'
  | 'VOTE_RESULT'
  | 'GAME_OVER';

export interface Player {
  id: string;
  name: string;
  roleId: string | null;
  alive: boolean;
  token: string | null;
  ackedRole: boolean;
}

export interface NightPick {
  targetId: string | null;
  confirmed: boolean;
  /** Every living player answers "who do you suspect?", whatever their role. */
  suspectId: string | null;
}

export interface Investigation {
  night: number;
  targetId: string;
  isMafia: boolean;
}

export interface MorningReport {
  night: number;
  killedIds: string[];
  /** Anonymous tally of everyone's "who do you suspect?" answers. */
  suspicions: Record<string, number>;
}

export type Ballot = string | 'skip';

export interface VoteState {
  candidates: string[];
  votes: Record<string, Ballot>;
  isRevote: boolean;
}

export interface VoteResult {
  tally: Record<string, number>;
  ballots: Record<string, Ballot>;
  eliminatedId: string | null;
  tie: boolean;
}

export interface Game {
  phase: Phase;
  players: Player[];
  roles: RoleDef[];
  roleCounts: Record<string, number>;
  settings: Settings;
  /** Current night / day number, starting at 1. */
  round: number;
  nightPicks: Record<string, NightPick>;
  lastProtected: Record<string, string>;
  selfSavesUsed: Record<string, number>;
  investigations: Record<string, Investigation[]>;
  morning: MorningReport | null;
  vote: VoteState | null;
  voteResult: VoteResult | null;
  winner: Team | null;
  /** Set when a single player won on their own (the suicide bomber). */
  soloWinnerId: string | null;
  discussionEndsAt: number | null;
  log: string[];
  deathCause: Record<string, 'night' | 'day'>;
  /** Living players who tapped "ready to vote" during the discussion. */
  readyToVote: string[];
  /** When the server will move to the next phase by itself. */
  autoAdvanceAt: number | null;
  storyId: string | null;
  /** The story "Play again" will use, picked when the game ends. */
  nextStoryId: string | null;
}

// ---- Views sent to clients ----

export interface PublicPlayer {
  id: string;
  name: string;
  alive: boolean;
  claimed: boolean;
  connected: boolean;
  /** Only present when this player's role is public (death reveal, game over). */
  roleId?: string;
  /** Only present when a death reveals just whether they were mafia. */
  isMafia?: boolean;
  /** Their phone reaches the host through a relay instead of directly. */
  relayed?: boolean;
}

export interface PublicState {
  phase: Phase;
  round: number;
  players: PublicPlayer[];
  roles: RoleDef[];
  roleCounts: Record<string, number>;
  settings: Settings;
  morning: MorningReport | null;
  voteResult: VoteResult | null;
  vote: { candidates: string[]; votedCount: number; voterCount: number; isRevote: boolean } | null;
  nightProgress: { done: number; total: number } | null;
  roleAcks: { done: number; total: number } | null;
  winner: Team | null;
  soloWinnerId: string | null;
  discussionEndsAt: number | null;
  log: string[];
  ready: { done: number; total: number } | null;
  autoAdvanceAt: number | null;
  storyId: string | null;
  nextStoryId: string | null;
  /** Lets clients correct countdowns for their own clock. */
  serverNow: number;
  /** Changes when a new version is deployed, so open pages know to reload. */
  build: string;
}

export interface GroupMemberPick {
  playerId: string;
  name: string;
  targetId: string | null;
  confirmed: boolean;
}

export interface PrivateNight {
  /** Everyone answers this first. */
  suspect: { prompt: string; validTargets: string[]; pick: string | null };
  /** null for roles without a night action. */
  kind: NightActionKind | null;
  prompt: string | null;
  validTargets: string[];
  pick: string | null;
  confirmed: boolean;
  group?: GroupMemberPick[];
  groupStatus?: string;
  /** False while a group (e.g. the mafia) still disagrees, even if this player confirmed. */
  groupSettled?: boolean;
}

export interface PrivateState {
  playerId: string;
  name: string;
  role: RoleDef;
  teammates: { id: string; name: string; roleName: string }[];
  ackedRole: boolean;
  night: PrivateNight | null;
  investigations: Investigation[];
  myVote: Ballot | null;
  readyToVote: boolean;
  /** Everyone's role, only for dead spectators (if allowed). */
  allRoles?: Record<string, string>;
}

export interface ClientState {
  public: PublicState;
  /** Which player this device has claimed, known even before roles are dealt. */
  you: { id: string; name: string } | null;
  me: PrivateState | null;
}
