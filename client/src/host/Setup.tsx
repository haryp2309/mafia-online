import { useState } from 'react';
import { suggestCounts } from '../../../shared/roles';
import { STORIES } from '../../../shared/stories';
import { validateSetup } from '../../../shared/rules';
import type { Ability, PublicState, RevealMode, RoleDef, Settings, Team } from '../../../shared/types';
import { roleEmoji } from '../ui';
import { send } from '../useGame';

const ABILITY_LABEL: Record<Ability, string> = {
  none: 'No night action',
  kill: 'Kill',
  protect: 'Protect',
  investigate: 'Investigate',
};

export function Setup({ pub }: { pub: PublicState }) {
  const [names, setNames] = useState<string[]>(pub.players.map((p) => p.name));
  const [draft, setDraft] = useState('');
  const [roles, setRoles] = useState<RoleDef[]>(pub.roles);
  const [counts, setCounts] = useState<Record<string, number>>(pub.roleCounts);
  const [settings, setSettings] = useState<Settings>(pub.settings);
  const [editing, setEditing] = useState<string | null>(null);
  // Until the host touches the counts, keep them matched to the number of players.
  const [countsTouched, setCountsTouched] = useState(pub.players.length > 0);

  const errors = validateSetup({ names, roles, roleCounts: counts });
  const total = roles.reduce((n, r) => n + (counts[r.id] ?? 0), 0);

  const addNames = () => {
    // Allow pasting a comma or newline separated list.
    const incoming = draft.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
    if (!incoming.length) return;
    applyNames([...names, ...incoming.filter((n) => !names.some((p) => p.toLowerCase() === n.toLowerCase()))]);
    setDraft('');
  };

  const applyNames = (next: string[]) => {
    setNames(next);
    if (!countsTouched) {
      const s = suggestCounts(next.length);
      setCounts(Object.fromEntries(roles.map((r) => [r.id, s[r.id] ?? 0])));
    }
  };

  const changeCount = (id: string, delta: number) => {
    setCountsTouched(true);
    setCounts((c) => ({ ...c, [id]: Math.max(0, (c[id] ?? 0) + delta) }));
  };

  const updateRole = (id: string, patch: Partial<RoleDef>) =>
    setRoles((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  const addRole = () => {
    const id = `custom-${Date.now().toString(36)}`;
    setRoles((prev) => [
      ...prev,
      { id, name: 'New role', team: 'town', ability: 'none', actsAsGroup: false, description: '' },
    ]);
    setCounts((c) => ({ ...c, [id]: 0 }));
    setEditing(id);
  };

  const removeRole = (id: string) => {
    setRoles((prev) => prev.filter((r) => r.id !== id));
    setCounts(({ [id]: _, ...rest }) => rest);
  };

  const suggest = () => {
    const s = suggestCounts(names.length);
    setCounts(Object.fromEntries(roles.map((r) => [r.id, s[r.id] ?? 0])));
  };

  const setSetting = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    setSettings((s) => ({ ...s, [key]: value }));

  return (
    <div className="setup">
      <section className="panel">
        <h2 className="title small-title">
          🎭 Players <span className="muted">({names.length})</span>
        </h2>
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            addNames();
          }}
        >
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Type a name and press Enter"
            autoFocus
          />
          <button type="submit" className="btn">Add</button>
        </form>
        <div className="chips">
          {names.map((n) => (
            <span key={n} className="chip">
              {n}
              <button aria-label={`Remove ${n}`} onClick={() => applyNames(names.filter((x) => x !== n))}>
                ×
              </button>
            </span>
          ))}
          {!names.length && <p className="muted">No players yet. You can paste a comma-separated list.</p>}
        </div>
      </section>

      <section className="panel">
        <div className="row spread">
          <h2 className="title small-title">
            🃏 Roles{' '}
            <span className={total === names.length ? 'muted' : 'bad'}>
              ({total} of {names.length})
            </span>
          </h2>
          <button className="btn small ghost" onClick={suggest} disabled={names.length < 3}>
            Suggest counts
          </button>
        </div>
        <div className="roles">
          {roles.map((r) => (
            <div key={r.id} className="role-row">
              <div className="row spread">
                <button className="link" onClick={() => setEditing(editing === r.id ? null : r.id)}>
                  <span className="role-emoji-sm">{roleEmoji(r)}</span> <b>{r.name}</b>{' '}
                  <span className={`tag team-${r.team}`}>{r.team}</span>{' '}
                  <span className="muted small">
                    {ABILITY_LABEL[r.ability]}
                    {r.ability !== 'none' && (r.actsAsGroup || (r.ability === 'investigate' && settings.policeTogether))
                      ? ' · as group'
                      : ''}
                  </span>
                </button>
                <div className="stepper">
                  <button
                    aria-label={`Fewer ${r.name}`}
                    onClick={() => changeCount(r.id, -1)}
                  >
                    −
                  </button>
                  <span>{counts[r.id] ?? 0}</span>
                  <button aria-label={`More ${r.name}`} onClick={() => changeCount(r.id, 1)}>
                    +
                  </button>
                </div>
              </div>
              {editing === r.id && (
                <div className="role-edit">
                  <label>
                    Name
                    <input value={r.name} onChange={(e) => updateRole(r.id, { name: e.target.value })} />
                  </label>
                  <label>
                    Team
                    <select value={r.team} onChange={(e) => updateRole(r.id, { team: e.target.value as Team })}>
                      <option value="town">Town</option>
                      <option value="mafia">Mafia</option>
                      <option value="neutral">Neutral</option>
                    </select>
                  </label>
                  <label>
                    Night ability
                    <select value={r.ability} onChange={(e) => updateRole(r.id, { ability: e.target.value as Ability })}>
                      {Object.entries(ABILITY_LABEL).map(([v, l]) => (
                        <option key={v} value={v}>
                          {l}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={r.actsAsGroup}
                      onChange={(e) => updateRole(r.id, { actsAsGroup: e.target.checked })}
                    />
                    Players with this role pick one shared target
                  </label>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={!!r.winsWhenVotedOut}
                      onChange={(e) => updateRole(r.id, { winsWhenVotedOut: e.target.checked })}
                    />
                    Wins alone if voted out during the day (everyone else loses)
                  </label>
                  <label className="wide">
                    Description shown on the role card
                    <textarea
                      rows={2}
                      value={r.description}
                      onChange={(e) => updateRole(r.id, { description: e.target.value })}
                    />
                  </label>
                  <button className="btn small ghost danger" onClick={() => removeRole(r.id)}>
                    Remove role
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
        <button className="btn small ghost" onClick={addRole}>
          + Add custom role
        </button>
      </section>

      <section className="panel">
        <h2 className="title small-title">📜 House rules</h2>
        <div className="settings">
          <label>
            Group decisions (mafia kill, police together)
            <select
              value={settings.groupConsensus}
              onChange={(e) => setSetting('groupConsensus', e.target.value as Settings['groupConsensus'])}
            >
              <option value="unanimous">Everyone must agree</option>
              <option value="majority">Majority decides</option>
              <option value="first">First to confirm decides</option>
            </select>
          </label>
          <label>
            Doctor can save themselves
            <select
              value={settings.doctorSelfSave}
              onChange={(e) => setSetting('doctorSelfSave', e.target.value as Settings['doctorSelfSave'])}
            >
              <option value="once">Once per game</option>
              <option value="always">Any night</option>
              <option value="never">Never</option>
            </select>
          </label>
          <label>
            Tied day vote
            <select value={settings.tieRule} onChange={(e) => setSetting('tieRule', e.target.value as Settings['tieRule'])}>
              <option value="noElimination">Nobody is voted out</option>
              <option value="revote">Revote between the tied players</option>
            </select>
          </label>
          <label>
            Discussion timer (minutes, 0 = off)
            <input
              type="number"
              min={0}
              step={0.5}
              value={settings.discussionSeconds / 60}
              onChange={(e) => setSetting('discussionSeconds', Math.max(0, Math.round(Number(e.target.value) * 60)))}
            />
          </label>
          <label>
            When someone is killed at night, reveal
            <RevealSelect value={settings.revealNightDeath} onChange={(v) => setSetting('revealNightDeath', v)} />
          </label>
          <label>
            When someone is voted out, reveal
            <RevealSelect value={settings.revealDayDeath} onChange={(v) => setSetting('revealDayDeath', v)} />
          </label>
          <label>
            Story
            <select value={settings.story} onChange={(e) => setSetting('story', e.target.value)}>
              <option value="random">Random story each game</option>
              {STORIES.map((st) => (
                <option key={st.id} value={st.id}>
                  {st.title}
                </option>
              ))}
            </select>
          </label>
          <label>
            Move on after results (seconds, 0 = host clicks next)
            <input
              type="number"
              min={0}
              value={settings.autoAdvanceSeconds}
              onChange={(e) => setSetting('autoAdvanceSeconds', Math.max(0, Math.round(Number(e.target.value))))}
            />
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={settings.policeTogether}
              onChange={(e) => setSetting('policeTogether', e.target.checked)}
            />
            Police investigate together: they see each other and agree on one person, like the mafia
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={settings.doctorNoRepeat}
              onChange={(e) => setSetting('doctorNoRepeat', e.target.checked)}
            />
            Doctor can't save the same person two nights in a row
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={settings.deadSeeRoles}
              onChange={(e) => setSetting('deadSeeRoles', e.target.checked)}
            />
            Dead players can see everyone's role
          </label>
        </div>
      </section>

      <div className="sticky-actions">
        {errors.length > 0 && <div className="bad small">{errors[0]}</div>}
        <button
          className="btn big"
          disabled={errors.length > 0}
          onClick={() => send('host:setup', { names, roles, roleCounts: counts, settings })}
        >
          Open lobby
        </button>
      </div>
    </div>
  );
}

function RevealSelect({ value, onChange }: { value: RevealMode; onChange: (v: RevealMode) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as RevealMode)}>
      <option value="role">Their role</option>
      <option value="team">Only whether they were mafia</option>
      <option value="none">Nothing</option>
    </select>
  );
}
