import { useEffect, useRef, useState } from 'react';
import type { ClientState, PrivateState, PublicState } from '../../../shared/types';
import { usePlayer, type PlayerStatus } from '../net/playerRuntime';
import {
  AutoAdvanceNote,
  Avatar,
  Countdown,
  DayStats,
  GameOverBanner,
  MorningNews,
  NightSky,
  playerName,
  roleEmoji,
  Stamp,
  TEAM_LABEL,
  Toast,
  VoteResultView,
} from '../ui';
import { send, useWakeLock } from '../useGame';
import { NightScreen } from './Night';

export function PlayerApp({ room }: { room: string }) {
  const { state, status, error, relayed, clearError, leave } = usePlayer(room);
  useWakeLock();
  usePhaseBuzz(state?.public.phase);
  const night = state?.public.phase === 'NIGHT';

  return (
    <div className={`app phone ${night ? 'is-night' : ''}`}>
      {night && <NightSky />}
      <StatusBanner status={status} hasState={!!state} />
      {relayed && <RelayWarning />}
      {!state ? (
        <Knocking status={status} room={room} />
      ) : state.you ? (
        <Playing state={state} leave={leave} />
      ) : (
        <Claim pub={state.public} />
      )}
      <Toast message={error} onClose={clearError} />
    </div>
  );
}

function Knocking({ status, room }: { status: PlayerStatus; room: string }) {
  return (
    <div className="center">
      <div className="big-emoji wobble">🚪</div>
      <h1 className="title">{status === 'host-offline' ? 'Knock knock…' : 'Finding the hideout…'}</h1>
      <p className="lead">
        {status === 'host-offline'
          ? `Nobody's home in room ${room} yet. Is the host screen open? We'll keep knocking.`
          : `Connecting to room ${room}…`}
      </p>
    </div>
  );
}

function StatusBanner({ status, hasState }: { status: PlayerStatus; hasState: boolean }) {
  if (!hasState || status === 'connected') return null;
  return <div className="banner warn">📡 Lost the host. Reconnecting…</div>;
}

/** Shown when this phone can only reach the host through a third-party relay server. */
function RelayWarning() {
  const [hidden, setHidden] = useState(false);
  if (hidden) return null;
  return (
    <div className="banner relay" role="status">
      <b>🛰️ Connected through a third-party relay.</b> Your network won't allow a direct connection, so game messages go
      through a free public relay service (they stay encrypted). For a faster, more private game, join the same Wi‑Fi as
      the host.
      <button className="link" onClick={() => setHidden(true)}>
        Got it
      </button>
    </div>
  );
}

function Claim({ pub }: { pub: PublicState }) {
  if (pub.phase === 'SETUP') {
    return (
      <div className="center">
        <div className="big-emoji wobble">🕶️</div>
        <h1 className="title">Almost there…</h1>
        <p className="lead">The host is still setting up the game. Hang tight!</p>
      </div>
    );
  }
  return (
    <div className="claim">
      <h1 className="title">Who are you?</h1>
      <p className="lead">Tap your own name. No peeking at others!</p>
      <div className="name-grid">
        {pub.players.map((p) => (
          <button key={p.id} className="name-card" disabled={p.claimed} onClick={() => send('player:claim', p.id)}>
            <Avatar name={p.name} size="lg" />
            <span>{p.name}</span>
            {p.claimed && <span className="taken">taken</span>}
          </button>
        ))}
      </div>
    </div>
  );
}

function Playing({ state, leave }: { state: ClientState; leave: () => void }) {
  const pub = state.public;
  const me = state.me;
  const you = state.you!;
  const alive = pub.players.find((p) => p.id === you.id)?.alive ?? true;

  return (
    <>
      <header className="phone-header">
        <div className="me">
          <Avatar name={you.name} dead={!alive} />
          <div>
            <div className="kicker">You are</div>
            <div className="me-name">{you.name}</div>
          </div>
        </div>
        {me && pub.phase !== 'ROLE_REVEAL' && <HoldToReveal me={me} compact />}
      </header>

      {!alive && pub.phase !== 'GAME_OVER' && <div className="banner ghost-banner">👻 You're dead. Watch quietly, no hints!</div>}

      <main className="phone-main">
        <PhaseView pub={pub} me={me} alive={alive} />
      </main>

      <footer className="phone-footer">
        <button className="link small" onClick={() => confirm(`Stop playing as ${you.name} on this phone?`) && leave()}>
          Not {you.name}?
        </button>
      </footer>
    </>
  );
}

function PhaseView({ pub, me, alive }: { pub: PublicState; me: PrivateState | null; alive: boolean }) {
  switch (pub.phase) {
    case 'CLAIMING':
      return (
        <div className="center">
          <div className="big-emoji bounce">🎟️</div>
          <h2 className="title">You're in!</h2>
          <p className="lead">Waiting for everyone to join. Roles are dealt when the host starts the game.</p>
        </div>
      );
    case 'ROLE_REVEAL':
      return me ? <RoleReveal me={me} /> : null;
    case 'NIGHT':
      if (me?.night) return <NightScreen pub={pub} me={me} night={me.night} />;
      return (
        <div className="center">
          <div className="big-emoji">🌙</div>
          <p className="lead">{alive ? 'Waiting for the night to end…' : 'The night goes on without you…'}</p>
        </div>
      );
    case 'MORNING':
      return (
        <>
          <MorningNews pub={pub} />
          <AutoAdvanceNote at={pub.autoAdvanceAt} label={pub.winner ? 'The winner is revealed' : 'The day begins'} />
          {me && <LatestInvestigation pub={pub} me={me} />}
          <DeadRoles pub={pub} me={me} />
        </>
      );
    case 'DAY_DISCUSSION':
      return (
        <>
          <MorningNews pub={pub} />
          <Countdown endsAt={pub.discussionEndsAt} />
          <p className="lead center-text">🗣️ Talk it out. Who is the mafia?</p>
          {alive && me && pub.ready && <ReadyToVote me={me} ready={pub.ready} />}
          <DayStats pub={pub} />
          {me && <Notebook pub={pub} me={me} />}
          <DeadRoles pub={pub} me={me} />
        </>
      );
    case 'DAY_VOTE':
      return alive ? (
        <Vote pub={pub} me={me} />
      ) : (
        <div className="center">
          <div className="big-emoji">🗳️</div>
          <p className="lead">The living are voting…</p>
        </div>
      );
    case 'VOTE_RESULT':
      return (
        <>
          <VoteResultView pub={pub} />
          <AutoAdvanceNote at={pub.autoAdvanceAt} label={pub.winner ? 'The winner is revealed' : 'Night falls'} />
        </>
      );
    case 'GAME_OVER':
      return <GameOverBanner pub={pub} />;
    default:
      return null;
  }
}

function RoleReveal({ me }: { me: PrivateState }) {
  return (
    <div className="reveal">
      <p className="lead center-text">🤫 Make sure nobody can see your screen.</p>
      <HoldToReveal me={me} />
      {me.ackedRole ? (
        <p className="auto-note">Waiting for everyone else… night falls by itself.</p>
      ) : (
        <button className="btn big" onClick={() => send('player:ackRole')}>
          Got it!
        </button>
      )}
    </div>
  );
}

/** The role is only on screen while the finger is down, so a glance over the shoulder shows nothing. */
function HoldToReveal({ me, compact }: { me: PrivateState; compact?: boolean }) {
  const [shown, setShown] = useState(false);
  const show = () => setShown(true);
  const hide = () => setShown(false);
  const handlers = {
    onPointerDown: show,
    onPointerUp: hide,
    onPointerLeave: hide,
    onPointerCancel: hide,
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
  };

  if (compact) {
    return (
      <>
        <button className="btn small ghost peek" {...handlers}>
          👀 Hold: my role
        </button>
        {shown && (
          <div className="peek-overlay">
            <RoleCard me={me} />
          </div>
        )}
      </>
    );
  }
  return (
    <div className="role-card-wrap" {...handlers}>
      {shown ? (
        <RoleCard me={me} />
      ) : (
        <div className="role-card envelope">
          <div className="big-emoji">✉️</div>
          <b>TOP SECRET</b>
          <span>Press and hold to peek at your role</span>
        </div>
      )}
    </div>
  );
}

function RoleCard({ me }: { me: PrivateState }) {
  return (
    <div className={`role-card team-${me.role.team}`}>
      <Stamp color={me.role.team === 'mafia' ? 'red' : me.role.team === 'town' ? 'teal' : 'purple'}>
        {TEAM_LABEL[me.role.team]}
      </Stamp>
      <div className="role-emoji">{roleEmoji(me.role)}</div>
      <div className="role-name">{me.role.name}</div>
      <p>{me.role.description}</p>
      {me.teammates.length > 0 && (
        <div className="teammates">
          <div className="kicker">Your crew</div>
          <div className="chips">
            {me.teammates.map((t) => (
              <span key={t.id} className="chip">
                <Avatar name={t.name} size="sm" /> {t.name}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function LatestInvestigation({ pub, me }: { pub: PublicState; me: PrivateState }) {
  const latest = me.investigations[me.investigations.length - 1];
  if (!latest || latest.night !== pub.morning?.night) return null;
  return (
    <div className={`panel case-file ${latest.isMafia ? 'is-mafia' : 'not-mafia'}`}>
      <div className="kicker">🕵️ Case file (secret)</div>
      <h2 className="headline">
        <Avatar name={playerName(pub, latest.targetId)} />
        <span>{playerName(pub, latest.targetId)} is</span>
        <Stamp color={latest.isMafia ? 'red' : 'teal'}>{latest.isMafia ? 'MAFIA' : 'NOT MAFIA'}</Stamp>
      </h2>
    </div>
  );
}

export function Notebook({ pub, me }: { pub: PublicState; me: PrivateState }) {
  if (!me.investigations.length) return null;
  return (
    <div className="panel">
      <div className="kicker">📒 Your notebook (secret)</div>
      {me.investigations.map((inv, i) => (
        <div key={i} className="row spread notebook-row">
          <span>
            Night {inv.night}: <b>{playerName(pub, inv.targetId)}</b>
          </span>
          <b className={inv.isMafia ? 'bad' : 'good'}>{inv.isMafia ? 'Mafia' : 'Not mafia'}</b>
        </div>
      ))}
    </div>
  );
}

function DeadRoles({ pub, me }: { pub: PublicState; me: PrivateState | null }) {
  if (!me?.allRoles) return null;
  return (
    <div className="panel">
      <div className="kicker">👻 Everyone's role (only the dead see this)</div>
      {pub.players.map((p) => (
        <div key={p.id} className="row spread notebook-row">
          <span className={p.alive ? '' : 'muted'}>{p.name}</span>
          <span>{me.allRoles![p.id]}</span>
        </div>
      ))}
    </div>
  );
}

function ReadyToVote({ me, ready }: { me: PrivateState; ready: { done: number; total: number } }) {
  return (
    <div className="ready-box">
      <button
        className={`btn big ${me.readyToVote ? 'teal' : ''}`}
        onClick={() => send('player:readyToVote', !me.readyToVote)}
      >
        {me.readyToVote ? '✔ Ready! (tap to undo)' : '✋ Ready to vote'}
      </button>
      <p className="small center-text">
        <b>
          {ready.done}/{ready.total}
        </b>{' '}
        ready. The vote starts when everyone is.
      </p>
    </div>
  );
}

function Vote({ pub, me }: { pub: PublicState; me: PrivateState | null }) {
  const vote = pub.vote!;
  const myVote = me?.myVote ?? null;
  const myId = me?.playerId;
  return (
    <div className="vote">
      <h2 className="title">{vote.isRevote ? 'Revote!' : 'Who should leave?'}</h2>
      <p className="small center-text">
        Change your mind any time until everyone has voted. <b>{vote.votedCount}</b>/{vote.voterCount} voted.
      </p>
      <div className="target-list">
        {vote.candidates
          .filter((id) => id !== myId)
          .map((id) => (
            <button key={id} className={`target ${myVote === id ? 'selected' : ''}`} onClick={() => send('player:vote', id)}>
              <Avatar name={playerName(pub, id)} />
              <span className="grow">{playerName(pub, id)}</span>
              {myVote === id && <span className="pick-mark">👉</span>}
            </button>
          ))}
        <button className={`target skip ${myVote === 'skip' ? 'selected' : ''}`} onClick={() => send('player:vote', 'skip')}>
          <span className="avatar avatar-md skip-avatar">🤷</span>
          <span className="grow">Skip: vote for nobody</span>
        </button>
      </div>
    </div>
  );
}

function usePhaseBuzz(phase: string | undefined) {
  const prev = useRef(phase);
  useEffect(() => {
    const canBuzz = 'vibrate' in navigator && navigator.userActivation?.hasBeenActive;
    if (prev.current && phase && prev.current !== phase && canBuzz) navigator.vibrate(200);
    prev.current = phase;
  }, [phase]);
}
