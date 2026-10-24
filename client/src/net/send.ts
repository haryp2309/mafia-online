/**
 * Components call `send('player:vote', id)` or `send('host:advance')` without caring where the
 * game lives. The host page handles it locally; a phone sends it to the host over WebRTC.
 */
type Handler = (event: string, args: unknown[]) => void;

let handler: Handler | null = null;

export function setSendHandler(h: Handler) {
  handler = h;
}

export function send(event: string, ...args: unknown[]) {
  handler?.(event, args);
}

/** Server-time correction so countdowns agree across devices (0 on the host itself). */
let clockOffset = 0;

export function setClockOffset(ms: number) {
  clockOffset = ms;
}

export function serverNow() {
  return Date.now() + clockOffset;
}
