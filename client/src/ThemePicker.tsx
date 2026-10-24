import { useState } from 'react';
import { applyTheme, currentTheme, THEMES, type ThemeId } from './theme';

/** Lets anyone try the different design languages on their own device. */
export function ThemePicker({ compact }: { compact?: boolean }) {
  const [theme, setTheme] = useState<ThemeId>(currentTheme);
  const pick = (id: ThemeId) => {
    applyTheme(id);
    setTheme(id);
  };

  if (compact) {
    return (
      <label className="theme-picker compact">
        <span aria-hidden>🎨</span>
        <select aria-label="Design" value={theme} onChange={(e) => pick(e.target.value as ThemeId)}>
          {THEMES.map((t) => (
            <option key={t.id} value={t.id}>
              {t.emoji} {t.name}
            </option>
          ))}
        </select>
      </label>
    );
  }

  return (
    <div className="theme-picker">
      <div className="kicker">🎨 Try a different look</div>
      <div className="theme-options">
        {THEMES.map((t) => (
          <button
            key={t.id}
            className={`theme-option ${theme === t.id ? 'selected' : ''}`}
            onClick={() => pick(t.id)}
            aria-pressed={theme === t.id}
          >
            <span className="theme-emoji" aria-hidden>
              {t.emoji}
            </span>
            <b>{t.name}</b>
            <span className="small">{t.blurb}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
