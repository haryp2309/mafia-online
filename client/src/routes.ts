/**
 * The app is static files (GitHub Pages, in a sub-folder), so screens are picked with query
 * parameters: ?host, ?bots, ?room=CODE. Old-style /host links still work through 404.html.
 */
const BASE = import.meta.env.BASE_URL;

export const routes = {
  home: BASE,
  host: `${BASE}?host`,
  join: (room: string) => `${BASE}?room=${room}`,
  bots: (room: string) => `${BASE}?bots&room=${room}`,
  nerd: `${BASE}?nerd`,
};

/** Absolute link for the QR code and for sharing. */
export function absolute(path: string): string {
  return new URL(path, window.location.origin).toString();
}

export type Screen = 'host' | 'bots' | 'nerd' | 'player' | 'landing';

export function currentScreen(roomCode: string): Screen {
  const params = new URLSearchParams(window.location.search);
  const rest = window.location.pathname.slice(BASE.length - 1);
  if (params.has('host') || rest.startsWith('/host')) return 'host';
  if (params.has('bots') || rest.startsWith('/bots')) return 'bots';
  if (params.has('nerd')) return 'nerd';
  if (roomCode.length === 5) return 'player';
  return 'landing';
}
