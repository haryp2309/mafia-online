import type { ClientState } from './types';

/** Messages a phone sends to the host browser. */
export type ClientMessage =
  | { t: 'hello'; build: string; token: string | null }
  | { t: 'act'; event: PlayerEvent; args: unknown[] };

/** Messages the host browser sends to a phone. */
export type HostMessage =
  | { t: 'state'; state: ClientState; build: string }
  | { t: 'error'; message: string }
  | { t: 'token'; token: string }
  | { t: 'token-invalid' };

/** Everything a phone may ask for. Host controls are never accepted over the network. */
export const PLAYER_EVENTS = [
  'player:claim',
  'player:leave',
  'player:ackRole',
  'player:nightPick',
  'player:nightConfirm',
  'player:suspect',
  'player:vote',
  'player:readyToVote',
] as const;
export type PlayerEvent = (typeof PLAYER_EVENTS)[number];

export type HostEvent =
  | 'host:setup'
  | 'host:backToSetup'
  | 'host:releaseClaim'
  | 'host:start'
  | 'host:advance'
  | 'host:forceNight'
  | 'host:playAgain'
  | 'host:reset';

/** PeerJS ids are global on the public broker, so rooms get a distinctive prefix. */
export const PEER_PREFIX = 'mafia-haryp-room-';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I or O, they look like 1 and 0

export function newRoomCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(5));
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}

export function normaliseRoomCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 5);
}
