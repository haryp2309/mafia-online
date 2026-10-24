import { useEffect, useState, type ReactNode } from "react";
import { routes } from "./routes";
import "./nerd.css";

const SOURCE_URL = "https://github.com/haryp2309/mafia-online";

/** "How it's built": a tour of the serverless architecture for tech-curious players. */
export function NerdPage() {
  return (
    <div className="app nerd">
      <nav className="nerd-top">
        <a className="btn small ghost" href={routes.home}>
          ← Back to the game
        </a>
      </nav>

      <header className="panel nerd-hero">
        <div className="kicker">🤓 How it's built</div>
        <h1 className="title">There is no game server.</h1>
        <p className="lead">
          The host's browser <em>is</em> the server. It runs the whole game,
          keeps the save file and does the narrator's voice. Every phone talks
          straight to it over a WebRTC data channel. The only outside help is a
          free matchmaker that introduces the devices, and a couple of STUN
          servers that help them find a direct path to each other. When a
          network blocks that, an end-to-end encrypted relay over free public
          MQTT servers takes over. Either way, the internet just carries the
          packets.
        </p>
        <ArchitectureDiagram />
        <ul className="nerd-legend small">
          <li>
            <span className="nerd-line solid" aria-hidden /> WebRTC data channel
            (the actual game traffic)
          </li>
          <li>
            <span className="nerd-line dotted" aria-hidden /> Setup only:
            introductions and path finding
          </li>
          <li>
            <span className="nerd-line dashed" aria-hidden /> Backup relay when
            direct is blocked: encrypted MQTT over public servers (or an
            optional TURN server)
          </li>
        </ul>
      </header>

      <Section emoji="🖥️" title="The host IS the server" open>
        <ul>
          <li>
            <code>shared/game.ts</code> is a pure game engine: a state machine
            that walks through{" "}
            <span className="nerd-phases">
              {PHASES.map((p) => (
                <code key={p}>{p}</code>
              ))}
            </span>
            . No network, no DOM, just rules, which is what makes it easy to
            unit test.
          </li>
          <li>
            <code>shared/host.ts</code> has the <code>HostController</code>. It
            owns the game, listens to the phones and decides who gets to know
            what.
          </li>
          <li>
            <code>shared/views.ts</code> builds a{" "}
            <strong>filtered view per device</strong>. Your phone never receives
            another player's role, so there is nothing to dig out of the dev
            tools.
          </li>
          <li>
            Phones may only send <code>player:*</code> events. Host commands
            like <code>host:advance</code> are simply ignored if they arrive
            over the network.
          </li>
          <li>
            Every change is saved in <code>localStorage</code> under{" "}
            <code>mafia-host-v1</code>, so if the host reloads the page, the
            game resumes where it was.
          </li>
          <li>
            When you claim a seat you get a secret <strong>seat token</strong>.
            After a reconnect your phone says <code>hello</code> with it and
            gets its seat back.
          </li>
          <li>
            The 5-letter room code (no I or O, they look like 1 and 0) gets the
            prefix <code>mafia-haryp-room-</code> and becomes the host's PeerJS
            peer id on the public broker. Typing the code is enough for a direct
            connection; the backup relay also needs the secret key from the QR
            code (see below).
          </li>
          <li>
            Each build carries a build stamp. A phone running an older version
            than the host reloads itself once, so everyone plays by the same
            rules.
          </li>
        </ul>
      </Section>

      <Section emoji="🛰️" title="When the network says no: the relay">
        <ul>
          <li>
            Some networks (guest Wi‑Fi, cellular NAT, VPNs) block direct WebRTC.
            The phone then sends the game through free{" "}
            <strong>public MQTT servers</strong> over WebSockets (
            <code>wss://</code>): EMQX, Mosquitto and HiveMQ, tried in that
            order. The phone tells the player plainly that a third-party service
            is in the middle, and the host sees a 🛰️ next to that player.
          </li>
          <li>
            The host makes a random <strong>256-bit room secret</strong> with{" "}
            <code>crypto.getRandomValues</code>. It travels only inside the QR
            code link, in the <code>#k=…</code> fragment, which browsers never
            send to any server. Typing the room code alone gives no key, so a
            phone that needs the relay is asked to scan the QR code instead.
          </li>
          <li>
            HKDF-SHA256 turns room code + secret into a 128-bit{" "}
            <strong>topic name</strong> (so outsiders can't find the room) and a{" "}
            <strong>room key</strong>. Under that key, phone and host do an ECDH
            P-256 handshake and derive a fresh AES-256-GCM key per connection.
            Every frame is encrypted and authenticated, with replay protection.
          </li>
          <li>
            The public servers only promise “fire and forget”, so the app adds
            its own delivery guarantees: sequence numbers, acknowledgements,
            re-sends and in-order delivery. A vote is never silently lost.
          </li>
          <li>
            The phone always tries direct first. The relay starts racing it
            after 5 seconds and the first link to open wins. While on the relay,
            the phone keeps trying to get back to a direct connection every 30
            seconds.
          </li>
          <li>
            Want to see it in action? Add <code>?relay</code> to the QR link (
            <code>…/?room=ABCDE&amp;relay#k=…</code>) to force the relay. The
            bot page takes it too.
          </li>
          <li>
            Honest limits: the relay servers see encrypted bytes, timing and
            sizes, but never the game. Anyone holding the QR link can join the
            room, just like anyone in the room can see the QR code on the
            screen. And the free servers may be slow or go away; then it is back
            to direct only.
          </li>
        </ul>
      </Section>

      <Section emoji="📨" title="What happens when you tap “vote”">
        <ol className="nerd-steps">
          <li>
            Your phone sends a tiny message over the data channel to the host
            browser.
          </li>
          <li>
            <code>HostController</code> checks it is a player event, works out
            which seat you are, and asks the engine to <code>castVote</code>.
            Illegal moves throw a <code>GameError</code> that is sent back as{" "}
            <code>{"{ t: 'error' }"}</code>.
          </li>
          <li>The host saves the new state to localStorage.</li>
          <li>Every connected device gets its own freshly filtered state.</li>
        </ol>
        <pre className="nerd-code">
          <code>{VOTE_SNIPPET}</code>
        </pre>
        <p className="small muted">
          The whole state is re-sent every time instead of a diff. It is small,
          and it makes reconnecting trivial: one message and you are up to date.
        </p>
      </Section>

      <Section emoji="🎙️" title="The narrator">
        <ul>
          <li>
            The voice is <strong>Kokoro-82M</strong>, an open text-to-speech
            model, run with <code>kokoro-js</code> (Transformers.js + ONNX
            Runtime Web) inside a Web Worker (<code>tts.worker.ts</code>) so the
            page never stutters.
          </li>
          <li>
            With <strong>WebGPU</strong> it uses the fp32 model (about 330 MB,
            downloaded once). Without it, it falls back to <strong>WASM</strong>{" "}
            on the CPU with the q8 model (about 90 MB).
          </li>
          <li>
            Measured: about <strong>0.6 s per line</strong> on WebGPU versus{" "}
            <strong>2.5–5 s</strong> on the CPU. That is why every line the game
            might need is pre-generated in priority order, current round first,
            and kept in memory as <code>AudioBuffer</code>s.
          </li>
          <li>
            <code>voice.ts</code> plays them through a one-phrase-at-a-time
            queue, so lines never talk over each other. If the model can't load,
            the browser's own <code>speechSynthesis</code> takes over.
          </li>
          <li>
            There are 10 story settings in <code>shared/stories.ts</code>, from
            “Rain on Ashford Street” to “Snowbound”.
          </li>
          <li>
            The night drone, the heartbeat and the “boom” are not audio files:
            they are synthesised live with the Web Audio API in{" "}
            <code>audio.ts</code>.
          </li>
        </ul>
      </Section>

      <Section emoji="🕵️" title="Fairness and secrecy tricks">
        <ul>
          <li>
            <strong>Hold to reveal:</strong> your role card only shows while
            your finger is on it, so a quick glance from a neighbour gets
            nothing.
          </li>
          <li>
            <strong>Identical night:</strong> everyone does their action first
            and answers the suspicion question last, and every phone ends on the
            same “All done” screen. Watching who taps longer tells you nothing.
          </li>
          <li>
            <strong>Anonymous suspicion chart:</strong> every night each player
            names a suspect, and in the morning the answers are shown as a chart
            without names. You see who is suspected, never who pointed.
          </li>
          <li>
            <strong>Team picks:</strong> the mafia (and the police, when they
            investigate together) see each other's picks live, so they can agree
            without whispering.
          </li>
        </ul>
      </Section>

      <Section emoji="🧰" title="Stack and numbers">
        <div className="chips nerd-chips">
          {STACK.map((s) => (
            <span key={s} className="tag">
              {s}
            </span>
          ))}
        </div>
        <table className="nerd-table">
          <caption className="small muted">Approximate download sizes</caption>
          <tbody>
            <tr>
              <th scope="row">Main JavaScript</th>
              <td>~424 KB (≈130 KB gzipped)</td>
            </tr>
            <tr>
              <th scope="row">Voice worker</th>
              <td>~2.2 MB</td>
            </tr>
            <tr>
              <th scope="row">ONNX Runtime WASM</th>
              <td>~21.6 MB, host only, when narration runs</td>
            </tr>
            <tr>
              <th scope="row">Voice model</th>
              <td>~330 MB (WebGPU) or ~90 MB (CPU), once</td>
            </tr>
          </tbody>
        </table>
      </Section>

      <Section emoji="📱" title="Your device right now" open>
        <DeviceChecks />
      </Section>

      <footer className="nerd-footer">
        <a className="btn" href={SOURCE_URL} target="_blank" rel="noreferrer">
          Read the source on GitHub
        </a>
        <a className="btn ghost" href={routes.home}>
          ← Back to the game
        </a>
      </footer>
    </div>
  );
}

const PHASES = [
  "SETUP",
  "CLAIMING",
  "ROLE_REVEAL",
  "NIGHT",
  "MORNING",
  "DAY_DISCUSSION",
  "DAY_VOTE",
  "VOTE_RESULT",
  "GAME_OVER",
];

const STACK = [
  "TypeScript",
  "React 19",
  "Vite",
  "PeerJS 1.5",
  "qrcode",
  "kokoro-js",
  "Vitest · 53 unit tests",
  "GitHub Actions → GitHub Pages",
  "Day/night design tokens · WCAG AA",
];

const VOTE_SNIPPET = `// phone → host
{ t: 'act', event: 'player:vote', args: [playerId] }

// host (shared/host.ts)
if (msg.t === 'act' && PLAYER_EVENTS.includes(msg.event))
  engine.castVote(game, me(), args[0]);
// …then save, and for every phone:
conn.send({ t: 'state', state: clientView(game, playerId, …), build });`;

/** A collapsible chapter of the page. */
function Section({
  emoji,
  title,
  open,
  children,
}: {
  emoji: string;
  title: string;
  open?: boolean;
  children: ReactNode;
}) {
  return (
    <details className="panel nerd-section" open={open}>
      <summary>
        <span aria-hidden>{emoji}</span> {title}
      </summary>
      <div className="nerd-body">{children}</div>
    </details>
  );
}

/** Boxes and wires, drawn with currentColor so it follows the theme. */
function ArchitectureDiagram() {
  return (
    <svg
      className="nerd-diagram"
      viewBox="0 0 360 320"
      role="img"
      aria-labelledby="nerd-diagram-title nerd-diagram-desc"
    >
      <title id="nerd-diagram-title">How the devices connect</title>
      <desc id="nerd-diagram-desc">
        The host browser in the middle runs the game engine, the save file and
        the narrator. Three phones connect to it directly with WebRTC data
        channels. The PeerJS broker at 0.peerjs.com only introduces the devices,
        STUN servers help them find a direct path, and a relay (encrypted MQTT
        over public servers, or an optional TURN server) carries traffic when no
        direct path exists.
      </desc>

      {/* setup-only wires */}
      <g className="wire dotted">
        <line x1="110" y1="66" x2="140" y2="122" />
        <line x1="24" y1="66" x2="24" y2="252" />
        <line x1="260" y1="66" x2="225" y2="122" />
      </g>
      {/* game traffic */}
      <g className="wire solid">
        <line x1="150" y1="192" x2="53" y2="252" />
        <line x1="180" y1="192" x2="180" y2="252" />
        <line x1="210" y1="192" x2="307" y2="252" />
      </g>
      <g className="wire dashed">
        <line x1="316" y1="190" x2="316" y2="252" />
      </g>

      <Box
        x={8}
        y={8}
        w={164}
        h={58}
        lines={["🤝 PeerJS broker", "0.peerjs.com", "introductions only"]}
      />
      <Box
        x={188}
        y={8}
        w={164}
        h={58}
        lines={["🧭 STUN", "stun.l.google.com", "stun.cloudflare.com"]}
      />
      <Box
        x={95}
        y={122}
        w={170}
        h={70}
        strong
        lines={["💻 Host browser", "game engine · localStorage", "🔊 narrator"]}
      />
      <Box
        x={278}
        y={136}
        w={76}
        h={54}
        dashed
        lines={["Relay", "MQTT", "/ TURN"]}
      />
      <Box x={8} y={252} w={90} h={44} lines={["📱 Phone"]} />
      <Box x={135} y={252} w={90} h={44} lines={["📱 Phone"]} />
      <Box x={262} y={252} w={90} h={44} lines={["📱 Phone"]} />

      <text className="nerd-svg-note" x="180" y="314" textAnchor="middle">
        WebRTC data channels
      </text>
    </svg>
  );
}

/** One labelled rectangle in the diagram; the first line is the bold title. */
function Box(props: {
  x: number;
  y: number;
  w: number;
  h: number;
  lines: string[];
  strong?: boolean;
  dashed?: boolean;
}) {
  const { x, y, w, h, lines, strong, dashed } = props;
  const lineH = 15;
  const top = y + h / 2 - ((lines.length - 1) * lineH) / 2 + 4;
  return (
    <g
      className={`nerd-box${strong ? " strong" : ""}${dashed ? " dashed" : ""}`}
    >
      <rect x={x} y={y} width={w} height={h} rx="10" />
      {lines.map((line, i) => (
        <text
          key={i}
          x={x + w / 2}
          y={top + i * lineH}
          textAnchor="middle"
          className={i === 0 ? "head" : undefined}
        >
          {line}
        </text>
      ))}
    </g>
  );
}

type GpuNavigator = Navigator & {
  gpu?: { requestAdapter(): Promise<unknown | null> };
};

interface Check {
  label: string;
  ok: boolean | null;
  detail: string;
}

/** Live feature detection for the browser reading this page. */
function DeviceChecks() {
  const [gpu, setGpu] = useState<boolean | null>(null);
  const [voices, setVoices] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const g = (navigator as GpuNavigator).gpu;
        const adapter = g ? await g.requestAdapter() : null;
        if (alive) setGpu(!!adapter);
      } catch {
        if (alive) setGpu(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!("speechSynthesis" in window)) {
      setVoices(0);
      return;
    }
    const load = () => setVoices(speechSynthesis.getVoices().length);
    load();
    speechSynthesis.addEventListener("voiceschanged", load);
    return () => speechSynthesis.removeEventListener("voiceschanged", load);
  }, []);

  const [sync] = useState(() => {
    let storage = false;
    try {
      const key = "mafia-nerd-probe";
      localStorage.setItem(key, "1");
      localStorage.removeItem(key);
      storage = true;
    } catch {
      storage = false;
    }
    return {
      webrtc: typeof RTCPeerConnection !== "undefined",
      isolated:
        typeof crossOriginIsolated !== "undefined" && crossOriginIsolated,
      threads: navigator.hardwareConcurrency || 0,
      wakeLock: "wakeLock" in navigator,
      storage,
    };
  });

  const checks: Check[] = [
    {
      label: "WebRTC",
      ok: sync.webrtc,
      detail: sync.webrtc
        ? "RTCPeerConnection is here, so you can join or host."
        : "No RTCPeerConnection: this browser cannot play.",
    },
    {
      label: "WebGPU",
      ok: gpu,
      detail:
        gpu === null
          ? "Asking the graphics card…"
          : gpu
            ? "Got a GPU adapter: the narrator would run on the graphics card (fast)."
            : "No adapter: the narrator would run on the CPU with the smaller model.",
    },
    {
      label: "Cross-origin isolated",
      ok: sync.isolated,
      detail: sync.isolated
        ? "SharedArrayBuffer is allowed, so WASM can use several threads."
        : "Multi-threaded WASM needs special COOP/COEP headers, and GitHub Pages can’t send them.",
    },
    {
      label: "CPU threads",
      ok: sync.threads > 0,
      detail:
        sync.threads > 0
          ? `${sync.threads} logical cores reported.`
          : "Your browser keeps this a secret.",
    },
    {
      label: "Screen Wake Lock",
      ok: sync.wakeLock,
      detail: sync.wakeLock
        ? "The screen can stay on during the game."
        : "Keep an eye on your auto-lock setting.",
    },
    {
      label: "Speech synthesis",
      ok: voices === null ? null : voices > 0,
      detail:
        voices === null
          ? "Counting voices…"
          : `${voices} built-in voice${voices === 1 ? "" : "s"} for the fallback narrator.`,
    },
    {
      label: "localStorage",
      ok: sync.storage,
      detail: sync.storage
        ? "Games and seats survive a reload."
        : "Blocked (private mode?): a reload starts over.",
    },
  ];

  return (
    <ul className="nerd-checks">
      {checks.map((c) => (
        <li key={c.label}>
          <span className="nerd-mark" aria-hidden>
            {c.ok === null ? "⏳" : c.ok ? "✅" : "❌"}
          </span>
          <span>
            <strong>
              {c.label}
              <span className="nerd-sr">
                : {c.ok === null ? "checking" : c.ok ? "yes" : "no"}
              </span>
            </strong>
            <span className="small muted nerd-detail">{c.detail}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
