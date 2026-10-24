import { useEffect, useState, useSyncExternalStore } from "react";
import { getStory } from "../../../shared/stories";
import type { PublicState } from "../../../shared/types";
import { useHost, type HostStatus } from "../net/hostRuntime";
import {
  AutoAdvanceNote,
  Avatar,
  Countdown,
  DayStats,
  deathReveal,
  GameOverBanner,
  MorningNews,
  NightSky,
  playerName,
  Progress,
  roleEmoji,
  Suspicions,
  Toast,
  VoteResultView,
} from "../ui";
import { send, useWakeLock } from "../useGame";
import { unlockAudioOnGesture } from "./audio";
import { routes } from "../routes";
import { ThemePicker } from "../ThemePicker";
import { Lobby } from "./Lobby";
import { narrationFor, useNarration } from "./narration";
import { Setup } from "./Setup";
import { browserVoices, KOKORO_VOICES, narrator } from "./voice";

const PHASE_TITLE: Record<PublicState["phase"], string> = {
  SETUP: "Set up the game",
  CLAIMING: "The lobby",
  ROLE_REVEAL: "Secret roles",
  NIGHT: "Night",
  MORNING: "Morning",
  DAY_DISCUSSION: "Day",
  DAY_VOTE: "The vote",
  VOTE_RESULT: "The verdict",
  GAME_OVER: "Game over",
};

const STATUS_LABEL: Record<HostStatus, string> = {
  starting: "Opening the room…",
  online: "Room open",
  reconnecting: "Reconnecting…",
  taken: "Room open in another tab?",
  offline: "Offline, retrying…",
};

export function HostApp() {
  const {
    state,
    status,
    roomCode,
    roomSecret,
    error,
    clearError,
    newerVersion,
  } = useHost();
  const [narrate, setNarrate] = useState(true);
  const [panel, setPanel] = useState(false);
  const pub = state.public;
  useNarration(pub, narrate);
  useEffect(unlockAudioOnGesture, []);
  useWakeLock();
  const night = pub.phase === "NIGHT";
  const story =
    pub.storyId && !["SETUP", "CLAIMING"].includes(pub.phase)
      ? getStory(pub.storyId).title
      : null;

  return (
    <div className={`app host ${night ? "is-night" : ""}`}>
      {night && <NightSky />}
      {newerVersion && (
        <div className="banner warn">
          ✨ A newer version of the app is available.{" "}
          <button className="link" onClick={() => window.location.reload()}>
            Reload the host
          </button>{" "}
          (the game is saved).
        </div>
      )}
      {status === "taken" && (
        <div className="banner warn">
          🚪 This room seems to be open in another tab or window. Close the
          other one; this screen will take over.
        </div>
      )}
      <header className="host-header">
        <div className="brand">
          <span className="logo small">MAFIA</span>
          <div>
            <div className="kicker">
              {story ? `📖 ${story}` : "Host screen"}
            </div>
            <h1 className="title">
              {PHASE_TITLE[pub.phase]}
              {["NIGHT", "DAY_DISCUSSION", "DAY_VOTE"].includes(pub.phase)
                ? ` ${pub.round}`
                : ""}
            </h1>
          </div>
        </div>
        <div className="header-tools">
          <span className={`status-pill status-${status}`}>
            <span className="dot" /> {STATUS_LABEL[status]} · <b>{roomCode}</b>
          </span>
          <button
            className="btn small ghost"
            onClick={() => setPanel((p) => !p)}
            aria-expanded={panel}
          >
            {narrate ? "🎙️ Narrator" : "🔇 Narrator off"}
          </button>
          <ThemePicker compact />
        </div>
      </header>
      {panel && (
        <NarrationPanel
          narrate={narrate}
          setNarrate={setNarrate}
          pub={pub}
          onClose={() => setPanel(false)}
        />
      )}

      {pub.phase === "SETUP" && <Setup pub={pub} />}
      {pub.phase === "CLAIMING" && (
        <Lobby pub={pub} roomCode={roomCode} roomSecret={roomSecret} />
      )}
      {!["SETUP", "CLAIMING"].includes(pub.phase) && <InGame pub={pub} />}

      <Toast message={error} onClose={clearError} />
    </div>
  );
}

function NarrationPanel({
  narrate,
  setNarrate,
  pub,
  onClose,
}: {
  narrate: boolean;
  setNarrate: (v: boolean) => void;
  pub: PublicState;
  onClose: () => void;
}) {
  const voice = useSyncExternalStore(narrator.subscribe, narrator.getState);
  const s = voice.settings;
  const [bVoices, setBVoices] = useState(browserVoices);
  useEffect(() => {
    if (!("speechSynthesis" in window)) return;
    const load = () => setBVoices(browserVoices());
    speechSynthesis.addEventListener("voiceschanged", load);
    return () => speechSynthesis.removeEventListener("voiceschanged", load);
  }, []);

  return (
    <div className="panel narration-panel">
      <div className="row spread">
        <h2 className="title small-title">🎙️ The narrator</h2>
        <button className="btn small ghost" onClick={onClose}>
          Close
        </button>
      </div>
      <label className="check">
        <input
          type="checkbox"
          checked={narrate}
          onChange={(e) => setNarrate(e.target.checked)}
        />
        Read the story aloud on this screen
      </label>
      <div className="settings">
        <label>
          Voice engine
          <select
            value={s.engine}
            onChange={(e) =>
              narrator.updateSettings({
                engine: e.target.value as "kokoro" | "browser",
              })
            }
          >
            <option value="kokoro">
              Kokoro: natural voice, made on this device
            </option>
            <option value="browser">
              Browser voice: instant, more robotic
            </option>
          </select>
        </label>
        {s.engine === "kokoro" ? (
          <label>
            Voice
            <select
              value={s.kokoroVoice}
              onChange={(e) =>
                narrator.updateSettings({ kokoroVoice: e.target.value })
              }
            >
              {KOKORO_VOICES.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <label>
            Voice
            <select
              value={s.browserVoice ?? ""}
              onChange={(e) =>
                narrator.updateSettings({
                  browserVoice: e.target.value || null,
                })
              }
            >
              <option value="">Best available</option>
              {bVoices.map((v) => (
                <option key={v.name} value={v.name}>
                  {v.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          Speed: {s.speed.toFixed(2)}×
          <input
            type="range"
            min={0.7}
            max={1.2}
            step={0.05}
            value={s.speed}
            onChange={(e) =>
              narrator.updateSettings({ speed: Number(e.target.value) })
            }
          />
        </label>
      </div>

      {s.engine === "kokoro" && (
        <div className="voice-progress">
          {voice.model === "error" ? (
            <p className="bad small">
              ⚠️ The Kokoro voice can't run on this device ({voice.error}).
              Using the browser voice instead.
            </p>
          ) : voice.model !== "ready" ? (
            <Progress
              done={Math.round(voice.download * 100)}
              total={100}
              label="% of the voice model downloaded (one time only; the browser keeps it)"
            />
          ) : (
            <Progress
              done={voice.prepared}
              total={voice.toPrepare}
              label={
                voice.toPrepare === 0
                  ? "Voice lines get prepared once players are in the lobby"
                  : voice.prepared < voice.toPrepare
                    ? "voice lines prepared. Missing lines are made on the spot."
                    : "voice lines ready to go!"
              }
            />
          )}
        </div>
      )}
      {s.engine === "kokoro" && voice.device && (
        <p className="small muted">
          Running on the{" "}
          {voice.device === "webgpu" ? "graphics card (fast)" : "processor"}
          {voice.secondsPerLine
            ? ` · about ${voice.secondsPerLine.toFixed(1)} s per line`
            : ""}
          .
        </p>
      )}
      <button
        className="btn small"
        onClick={() =>
          narrator.speak(
            narrationFor(pub) || "Good evening. Welcome to the family.",
          )
        }
      >
        ▶ Test the voice
      </button>
    </div>
  );
}

function InGame({ pub }: { pub: PublicState }) {
  const caption = narrationFor(pub);
  return (
    <div className="host-grid">
      <main className="stage">
        {caption && (
          <div className="narrator-bubble">
            <span className="narrator-face" aria-hidden>
              🎩
            </span>
            <p>{caption}</p>
          </div>
        )}
        <Stage pub={pub} />
      </main>
      <aside className="sidebar">
        <section className="panel">
          <div className="kicker">🎭 The suspects</div>
          <ul className="player-list">
            {pub.players.map((p) => {
              const role = pub.roles.find((r) => r.id === p.roleId);
              return (
                <li key={p.id} className={p.alive ? "" : "dead"}>
                  <Avatar name={p.name} dead={!p.alive} size="sm" />
                  <span className="grow">{p.name}</span>
                  {role ? (
                    <span className={`tag team-${role.team}`}>
                      {roleEmoji(role)} {role.name}
                    </span>
                  ) : (
                    p.isMafia !== undefined && (
                      <span
                        className={`tag team-${p.isMafia ? "mafia" : "town"}`}
                      >
                        {deathReveal(pub, p.id)}
                      </span>
                    )
                  )}
                  {p.relayed && (
                    <span
                      className="relay-badge"
                      title="Connected through a third-party relay"
                      aria-label="relayed"
                    >
                      🛰️
                    </span>
                  )}
                  <span
                    className={`conn ${p.connected ? "on" : "off"}`}
                    title={
                      p.connected ? "Phone connected" : "Phone disconnected"
                    }
                  />
                </li>
              );
            })}
          </ul>
        </section>
        <section className="panel">
          <div className="kicker">🃏 In this game</div>
          <div className="chips">
            {pub.roles
              .filter((r) => pub.roleCounts[r.id])
              .map((r) => (
                <span key={r.id} className={`tag team-${r.team}`}>
                  {pub.roleCounts[r.id]} × {roleEmoji(r)} {r.name}
                </span>
              ))}
          </div>
        </section>
        {pub.log.length > 0 && (
          <section className="panel">
            <div className="kicker">📜 What happened</div>
            <ol className="log">
              {pub.log.map((l, i) => (
                <li key={i}>{l}</li>
              ))}
            </ol>
          </section>
        )}
        <button
          className="btn small ghost danger"
          onClick={() =>
            confirm(
              "End this game and go back to setup? Everyone will need to pick their name again.",
            ) && send("host:reset")
          }
        >
          Reset game
        </button>
        <a
          className="nerd-link"
          href={routes.nerd}
          target="_blank"
          rel="noreferrer"
        >
          🤓 How it's built
        </a>
      </aside>
    </div>
  );
}

function Stage({ pub }: { pub: PublicState }) {
  switch (pub.phase) {
    case "ROLE_REVEAL": {
      const acks = pub.roleAcks!;
      return (
        <>
          <div className="big-emoji wobble">🤫</div>
          <p className="lead">
            Everyone, peek at your role in secret, then tap “Got it!”.
          </p>
          <Progress
            done={acks.done}
            total={acks.total}
            label="have seen their role"
          />
          <AutoAdvanceNote at={pub.autoAdvanceAt} label="Night falls" />
          <button
            className={acks.done < acks.total ? "btn ghost" : "btn big"}
            onClick={() => send("host:advance")}
          >
            {acks.done < acks.total
              ? "Start night 1 anyway"
              : "Start night 1 now"}
          </button>
        </>
      );
    }
    case "NIGHT": {
      const prog = pub.nightProgress!;
      return (
        <>
          <div className="night-title">Shhh…</div>
          <p className="lead">
            Everyone, close your eyes and look only at your own phone.
          </p>
          <Progress
            done={prog.done}
            total={prog.total}
            label="are done for the night"
          />
          <p className="small">
            The night ends by itself when everyone has chosen.
          </p>
          <button
            className="btn small ghost danger"
            onClick={() =>
              confirm(
                "End the night now? Anyone who has not confirmed will skip their action.",
              ) && send("host:forceNight")
            }
          >
            Force end night
          </button>
        </>
      );
    }
    case "MORNING":
      return (
        <>
          <MorningNews pub={pub} />
          <Suspicions pub={pub} />
          <AutoAdvanceNote
            at={pub.autoAdvanceAt}
            label={pub.winner ? "The winner is revealed" : "The day begins"}
          />
          <button className="btn ghost" onClick={() => send("host:advance")}>
            {pub.winner ? "Reveal the winner now" : "Start the day now"}
          </button>
        </>
      );
    case "DAY_DISCUSSION":
      return (
        <>
          <MorningNews pub={pub} />
          <p className="lead">
            🗣️ Talk it out! The vote starts when everyone taps “Ready to vote”.
          </p>
          <Countdown endsAt={pub.discussionEndsAt} />
          {pub.ready && (
            <Progress
              done={pub.ready.done}
              total={pub.ready.total}
              label="are ready to vote"
            />
          )}
          <DayStats pub={pub} />
          <button className="btn ghost" onClick={() => send("host:advance")}>
            Start the vote now
          </button>
        </>
      );
    case "DAY_VOTE": {
      const v = pub.vote!;
      return (
        <>
          <div className="big-emoji bounce">🗳️</div>
          {v.isRevote && (
            <p className="lead">
              It's a tie! Revote between{" "}
              <b>
                {v.candidates.map((id) => playerName(pub, id)).join(" and ")}
              </b>
              .
            </p>
          )}
          <p className="lead">
            Vote on your phone. Votes are revealed when everyone has voted.
          </p>
          <Progress
            done={v.votedCount}
            total={v.voterCount}
            label="have voted"
          />
          <button className="btn ghost" onClick={() => send("host:advance")}>
            Close the vote now
          </button>
        </>
      );
    }
    case "VOTE_RESULT":
      return (
        <>
          <VoteResultView pub={pub} />
          <AutoAdvanceNote
            at={pub.autoAdvanceAt}
            label={pub.winner ? "The winner is revealed" : "Night falls"}
          />
          <button className="btn ghost" onClick={() => send("host:advance")}>
            {pub.winner
              ? "Reveal the winner now"
              : `Start night ${pub.round + 1} now`}
          </button>
        </>
      );
    case "GAME_OVER":
      return (
        <>
          <GameOverBanner pub={pub} />
          <div className="row">
            <button
              className="btn big grow"
              onClick={() => send("host:playAgain")}
            >
              🔁 Play again (new roles)
            </button>
            <button className="btn ghost" onClick={() => send("host:reset")}>
              New setup
            </button>
          </div>
        </>
      );
    default:
      return null;
  }
}
