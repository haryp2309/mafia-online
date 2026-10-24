import './themes/neon.css';
import './themes/cozy.css';
import './themes/deco.css';
import './themes/minimal.css';

/**
 * Alternative design languages to try out. Each lives in client/src/themes/<id>.css, scoped
 * to <html data-theme="id">, on top of the default comic look. The choice is per device:
 * from ?theme=<id> in the address, or the picker, remembered in localStorage.
 */
export const THEMES = [
  { id: 'comic', name: 'Noir Comic', emoji: '💥', blurb: 'Ink outlines, halftone dots, bursts', fonts: [] },
  {
    id: 'neon',
    name: 'Neon Carnival',
    emoji: '🎰',
    blurb: 'Glowing signs, casino chips, sparkle',
    fonts: ['Monoton', 'Righteous', 'Quicksand:wght@500;700'],
  },
  {
    id: 'cozy',
    name: 'Cozy Board Game',
    emoji: '🎲',
    blurb: 'Warm wood and paper, chunky cards',
    fonts: ['Fredoka:wght@500;600;700', 'Nunito:wght@600;700;800;900'],
  },
  {
    id: 'deco',
    name: 'Art Deco Speakeasy',
    emoji: '🥂',
    blurb: '1920s gold, black and geometry',
    fonts: ['Limelight', 'Josefin+Sans:wght@400;600;700', 'Playfair+Display:ital,wght@0,400;0,700;1,400;1,700'],
  },
  {
    id: 'minimal',
    name: 'Clean Minimal',
    emoji: '◻️',
    blurb: 'Calm, airy, modern and crisp',
    fonts: ['Inter:wght@400;500;600;700;800'],
  },
] as const;

export type ThemeId = (typeof THEMES)[number]['id'];

const KEY = 'mafia-theme';

function isTheme(id: string | null): id is ThemeId {
  return THEMES.some((t) => t.id === id);
}

export function currentTheme(): ThemeId {
  const fromUrl = new URLSearchParams(window.location.search).get('theme');
  if (isTheme(fromUrl)) return fromUrl;
  try {
    const saved = localStorage.getItem(KEY);
    if (isTheme(saved)) return saved;
  } catch {
    // No storage: default look.
  }
  return 'comic';
}

/** Each look loads its own Google Fonts only when it's picked. */
function loadFonts(id: ThemeId) {
  const theme = THEMES.find((t) => t.id === id);
  if (!theme?.fonts.length || document.getElementById(`fonts-${id}`)) return;
  const link = document.createElement('link');
  link.id = `fonts-${id}`;
  link.rel = 'stylesheet';
  link.crossOrigin = 'anonymous';
  link.href = `https://fonts.googleapis.com/css2?${theme.fonts.map((f) => `family=${f}`).join('&')}&display=swap`;
  document.head.appendChild(link);
}

export function applyTheme(id: ThemeId) {
  loadFonts(id);
  document.documentElement.dataset.theme = id;
  try {
    localStorage.setItem(KEY, id);
  } catch {
    // Remembering the look is only a convenience.
  }
}
