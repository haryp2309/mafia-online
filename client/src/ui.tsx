import { useMemo, type ReactNode } from 'react';
import type { PublicState, RoleDef, Team } from '../../shared/types';
import { useNow } from './useGame';

export function playerName(pub: PublicState, id: string | null | undefined): string {
  return pub.players.find((p) => p.id === id)?.name ?? '—';
}

export function roleName(pub: PublicState, roleId: string | undefined): string | undefined {
  return pub.roles.find((r) => r.id === roleId)?.name;
}

export const TEAM_LABEL: Record<Team, string> = { mafia: 'Mafia', town: 'Town', neutral: 'Solo' };

const ROLE_EMOJI: Record<string, string> = {
  mafia: '🕶️',
  police: '🕵️',
  doctor: '🩺',
  farmer: '🌾',
  bomber: '💣',
};
const ABILITY_EMOJI: Record<string, string> = { kill: '🗡️', protect: '🛡️', investigate: '🔍', none: '🙂' };

export function roleEmoji(role: Pick<RoleDef, 'id' | 'ability'> | undefined): string {
  if (!role) return '❔';
  return ROLE_EMOJI[role.id] ?? ABILITY_EMOJI[role.ability] ?? '🙂';
}

/** What is public about a dead player: "a Farmer", "MAFIA", "not mafia", or nothing. */
export function deathReveal(pub: PublicState, id: string | null | undefined): string | null {
  const p = pub.players.find((x) => x.id === id);
  if (!p) return null;
  const role = roleName(pub, p.roleId);
  if (role) return `a ${role}`;
  if (p.isMafia !== undefined) return p.isMafia ? 'MAFIA' : 'not mafia';
  return null;
}

// ---------- little comic building blocks ----------

/** Bright party colours for confetti. */
const CONFETTI_COLORS = ['#e2303f', '#ffc531', '#22b5a5', '#3d6fd9', '#8d5bd6', '#f57b2b', '#e05aa0', '#5bb84a'];

/** Avatar fills, each with a letter colour that reads at 4.5:1 or better. */
const AVATAR_COLORS: { bg: string; fg: string }[] = [
  { bg: '#c0283a', fg: '#ffffff' },
  { bg: '#ffc531', fg: '#17121f' },
  { bg: '#0e7c70', fg: '#ffffff' },
  { bg: '#2f5fc4', fg: '#ffffff' },
  { bg: '#6f42c1', fg: '#ffffff' },
  { bg: '#f57b2b', fg: '#17121f' },
  { bg: '#a3245e', fg: '#ffffff' },
  { bg: '#7ed957', fg: '#17121f' },
];

function hash(s: string): number {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0;
  return Math.abs(h);
}

/** A round comic face with the player's initial, colour picked from their name. */
export function Avatar({ name, dead, size = 'md' }: { name: string; dead?: boolean; size?: 'sm' | 'md' | 'lg' }) {
  if (dead) {
    // One look for every dead player: a slate disc with a white cross.
    return (
      <span className={`avatar avatar-${size} is-dead`} aria-hidden>
        ✖
      </span>
    );
  }
  const { bg, fg } = AVATAR_COLORS[hash(name) % AVATAR_COLORS.length];
  // Light letters get an ink outline; dark letters on light fills don't need one.
  const textShadow = fg === '#ffffff' ? undefined : 'none';
  return (
    <span className={`avatar avatar-${size}`} style={{ background: bg, color: fg, textShadow }} aria-hidden>
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

/** Comic-book explosion bubble ("BANG!", "SAVED!"). */
export function Burst({ children, color = 'red' }: { children: ReactNode; color?: 'red' | 'gold' | 'teal' | 'purple' }) {
  return <div className={`burst burst-${color}`}>{children}</div>;
}

export function Stamp({ children, color = 'red' }: { children: ReactNode; color?: 'red' | 'teal' | 'purple' }) {
  return <span className={`stamp stamp-${color}`}>{children}</span>;
}

/** Twinkling stars and a moon behind night screens. */
export function NightSky() {
  const stars = useMemo(
    () =>
      Array.from({ length: 40 }, (_, i) => ({
        left: `${(i * 37) % 100}%`,
        top: `${(i * 53) % 70}%`,
        delay: `${(i % 7) * 0.45}s`,
        size: 2 + (i % 3),
      })),
    [],
  );
  return (
    <div className="night-sky" aria-hidden>
      <div className="moon" />
      {stars.map((s, i) => (
        <span key={i} className="star" style={{ left: s.left, top: s.top, animationDelay: s.delay, width: s.size, height: s.size }} />
      ))}
    </div>
  );
}

export function Confetti() {
  const pieces = useMemo(
    () =>
      Array.from({ length: 60 }, (_, i) => ({
        left: `${(i * 17) % 100}%`,
        delay: `${(i % 12) * 0.18}s`,
        duration: `${2.6 + (i % 5) * 0.4}s`,
        color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
        rotate: `${(i * 47) % 360}deg`,
      })),
    [],
  );
  return (
    <div className="confetti" aria-hidden>
      {pieces.map((p, i) => (
        <span
          key={i}
          style={{ left: p.left, animationDelay: p.delay, animationDuration: p.duration, background: p.color, rotate: p.rotate }}
        />
      ))}
    </div>
  );
}

export function Toast({ message, onClose }: { message: string | null; onClose: () => void }) {
  if (!message) return null;
  return (
    <div className="toast" role="alert" onClick={onClose}>
      <span aria-hidden>💥</span> {message}
    </div>
  );
}

export function Progress({ done, total, label }: { done: number; total: number; label: string }) {
  return (
    <div className="progress">
      <div className="progress-bar">
        <span style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
      </div>
      <div className="progress-label">
        <b>
          {done}/{total}
        </b>{' '}
        {label}
      </div>
    </div>
  );
}

export function Countdown({ endsAt }: { endsAt: number | null }) {
  const now = useNow(500);
  if (!endsAt) return null;
  const left = Math.max(0, Math.ceil((endsAt - now) / 1000));
  const m = Math.floor(left / 60);
  const s = String(left % 60).padStart(2, '0');
  return <div className={`countdown ${left === 0 ? 'done' : ''}`}>⏱ {left === 0 ? "Time's up!" : `${m}:${s}`}</div>;
}

/** "Night falls in 7…" while the game will move on by itself. */
export function AutoAdvanceNote({ at, label }: { at: number | null; label: string }) {
  const now = useNow(250);
  if (!at) return null;
  const left = Math.max(0, Math.ceil((at - now) / 1000));
  return (
    <div className="auto-note">
      {label} in <b>{left}</b>…
    </div>
  );
}

// ---------- results ----------

/** Morning announcement: who died tonight, comic-book style. */
export function MorningNews({ pub }: { pub: PublicState }) {
  const m = pub.morning;
  if (!m) return null;
  return (
    <div className="news">
      <div className="kicker">☀️ Morning of day {m.night}</div>
      {m.killedIds.length === 0 ? (
        <>
          <Burst color="teal">SAVED!</Burst>
          <h2 className="headline">Nobody died last night.</h2>
        </>
      ) : (
        <>
          <Burst>BANG!</Burst>
          {m.killedIds.map((id) => {
            const reveal = deathReveal(pub, id);
            return (
              <h2 key={id} className="headline">
                <Avatar name={playerName(pub, id)} dead size="lg" />
                <span>
                  {playerName(pub, id)} was killed{reveal ? <span className="reveal">, {reveal}</span> : null}.
                </span>
              </h2>
            );
          })}
        </>
      )}
    </div>
  );
}

export function Suspicions({ pub }: { pub: PublicState }) {
  const entries = Object.entries(pub.morning?.suspicions ?? {}).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return null;
  const max = entries[0][1];
  return (
    <div className="panel">
      <div className="kicker">🔎 Who the town suspects (anonymous)</div>
      {entries.map(([id, n]) => (
        <div key={id} className="bar-row">
          <Avatar name={playerName(pub, id)} size="sm" />
          <span className="bar-name">{playerName(pub, id)}</span>
          <span className="bar">
            <span style={{ width: `${(n / max) * 100}%` }} />
          </span>
          <span className="num">{n}</span>
        </div>
      ))}
    </div>
  );
}

/** Clues for the discussion: last night's anonymous suspicions and yesterday's votes. */
export function DayStats({ pub }: { pub: PublicState }) {
  const lastVote = pub.round > 1 ? pub.voteResult : null;
  return (
    <>
      <Suspicions pub={pub} />
      {lastVote && Object.keys(lastVote.ballots).length > 0 && (
        <div className="panel">
          <div className="kicker">🗳️ Day {pub.round - 1} votes</div>
          <Ballots pub={pub} ballots={lastVote.ballots} />
        </div>
      )}
    </>
  );
}

function Ballots({ pub, ballots }: { pub: PublicState; ballots: Record<string, string> }) {
  return (
    <div className="ballots">
      {Object.entries(ballots).map(([voter, ballot]) => (
        <div key={voter} className="ballot">
          <b>{playerName(pub, voter)}</b> <span className="arrow">→</span>{' '}
          {ballot === 'skip' ? <i>skip</i> : <b className="accused">{playerName(pub, ballot)}</b>}
        </div>
      ))}
    </div>
  );
}

export function VoteResultView({ pub }: { pub: PublicState }) {
  const r = pub.voteResult;
  if (!r) return null;
  const out = r.eliminatedId;
  const reveal = deathReveal(pub, out);
  return (
    <div className="news">
      <div className="kicker">🗳️ Day {pub.round} vote</div>
      {out ? (
        <>
          <Burst color={pub.soloWinnerId === out ? 'purple' : 'red'}>{pub.soloWinnerId === out ? 'KA-BOOM!' : 'GUILTY!'}</Burst>
          <h2 className="headline">
            <Avatar name={playerName(pub, out)} dead size="lg" />
            <span>
              {playerName(pub, out)} was voted out{reveal ? <span className="reveal">, {reveal}</span> : null}.
            </span>
          </h2>
        </>
      ) : (
        <>
          <Burst color="gold">PHEW!</Burst>
          <h2 className="headline">{r.tie ? 'A tie! Nobody was voted out.' : 'Nobody was voted out.'}</h2>
        </>
      )}
      <Ballots pub={pub} ballots={r.ballots} />
    </div>
  );
}

export function GameOverBanner({ pub }: { pub: PublicState }) {
  const solo = pub.soloWinnerId;
  const title = solo
    ? `${playerName(pub, solo)} wins alone!`
    : pub.winner === 'mafia'
      ? 'The Mafia win!'
      : 'The Town wins!';
  return (
    <div className={`news gameover winner-${pub.winner}`}>
      <Confetti />
      <div className="kicker">🏁 Game over</div>
      <h1 className="mega">{title}</h1>
      {solo && (
        <p className="lead">
          {playerName(pub, solo)} was the {roleName(pub, pub.players.find((p) => p.id === solo)?.roleId)} 💣 The town fell for it,
          and everyone else loses.
        </p>
      )}
      <ul className="role-list">
        {pub.players.map((p) => {
          const role = pub.roles.find((r) => r.id === p.roleId);
          return (
            <li key={p.id} className={p.alive ? '' : 'dead'}>
              <Avatar name={p.name} dead={!p.alive} size="sm" />
              <span className="grow">{p.name}</span>
              <span className={`tag team-${role?.team}`}>
                {roleEmoji(role)} {role?.name}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
