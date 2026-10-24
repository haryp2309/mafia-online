import { useState } from 'react';
import type { PrivateNight, PrivateState, PublicState } from '../../../shared/types';
import { Avatar, playerName } from '../ui';
import { send } from '../useGame';

/**
 * Roles with a night action do it first; everyone then answers "who do you suspect?" last,
 * so every phone ends the night on the same "Done" screen. A glance at someone's phone
 * gives nothing away.
 */
export function NightScreen({ pub, me, night }: { pub: PublicState; me: PrivateState; night: PrivateNight }) {
  const [changingSuspect, setChangingSuspect] = useState(false);
  const suspected = night.suspect.pick;

  // Mafia stay on their action until the whole group agrees, as they may need to change it.
  const actionPending = !!night.kind && (!night.confirmed || night.groupSettled === false);
  if (actionPending) return <ActionStep pub={pub} me={me} night={night} />;

  if (!suspected || changingSuspect) {
    return (
      <SuspectStep
        pub={pub}
        night={night}
        onDone={(id) => {
          send('player:suspect', id);
          setChangingSuspect(false);
        }}
      />
    );
  }

  return (
    <div className="night-screen done-screen">
      <div className="kicker">🌙 Night {pub.round}</div>
      <div className="big-emoji sleepy">😴</div>
      <h2 className="title">All done!</h2>
      <p className="lead">Close your eyes and wait for the morning…</p>
      <div className="suspect-line">
        You suspect <b>{playerName(pub, suspected)}</b>.{' '}
        <button className="link" onClick={() => setChangingSuspect(true)}>
          Change
        </button>
      </div>
    </div>
  );
}

function SuspectStep({ pub, night, onDone }: { pub: PublicState; night: PrivateNight; onDone: (id: string) => void }) {
  const [selected, setSelected] = useState<string | null>(night.suspect.pick);
  return (
    <div className="night-screen">
      <div className="kicker">🌙 Night {pub.round}</div>
      <h2 className="title">{night.suspect.prompt}</h2>
      <p className="small">Everyone answers this. The answers are shown anonymously in the morning.</p>
      <div className="target-list">
        {night.suspect.validTargets.map((id) => (
          <button key={id} className={`target ${selected === id ? 'selected' : ''}`} onClick={() => setSelected(id)}>
            <Avatar name={playerName(pub, id)} />
            <span className="grow">{playerName(pub, id)}</span>
            {selected === id && <span className="pick-mark">🤨</span>}
          </button>
        ))}
      </div>
      <div className="sticky-actions">
        <button className="btn big" disabled={!selected} onClick={() => selected && onDone(selected)}>
          {selected ? `Confirm ${playerName(pub, selected)}` : 'Pick someone'}
        </button>
      </div>
    </div>
  );
}

function ActionStep({ pub, me, night }: { pub: PublicState; me: PrivateState; night: PrivateNight }) {
  const picksFor = (id: string) => night.group?.filter((m) => m.playerId !== me.playerId && m.targetId === id) ?? [];
  const agreed = night.groupStatus?.startsWith('Agreed');

  return (
    <div className="night-screen">
      <div className="kicker">🌙 Night {pub.round}</div>
      <h2 className="title">{night.prompt}</h2>

      {night.group && <div className={`group-status ${agreed ? 'good' : ''}`}>{agreed ? '🤝 ' : '💬 '}{night.groupStatus}</div>}

      <div className="target-list">
        {night.validTargets.map((id) => {
          const others = picksFor(id);
          return (
            <button key={id} className={`target ${night.pick === id ? 'selected' : ''}`} onClick={() => send('player:nightPick', id)}>
              <Avatar name={playerName(pub, id)} />
              <span className="grow">
                {playerName(pub, id)}
                {id === me.playerId ? ' (you)' : ''}
              </span>
              {others.length > 0 && (
                <span className="group-picks">{others.map((m) => `${m.name}${m.confirmed ? ' ✔' : ''}`).join(', ')}</span>
              )}
              {night.pick === id && <span className="pick-mark">🎯</span>}
            </button>
          );
        })}
      </div>

      <div className="sticky-actions">
        {night.confirmed ? (
          <div className="locked">
            <b>🔒 Locked in.</b> Waiting for your crew to agree. Tap another name to change.
          </div>
        ) : (
          <button className="btn big" disabled={!night.pick} onClick={() => send('player:nightConfirm')}>
            {night.pick ? `Confirm ${playerName(pub, night.pick)}` : 'Pick someone'}
          </button>
        )}
      </div>
    </div>
  );
}
