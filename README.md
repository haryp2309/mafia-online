# Mafia Online

Play Mafia in a room together: one shared host screen plus everyone's phone. No accounts and no game server: the host's browser runs the game and phones connect to it directly over WebRTC.

**Play:** https://haryp2309.github.io/mafia-online/

## How it works

- **Host screen** (`?host`): a laptop or TV everyone can see. It runs the game, saves it in the browser's storage (a reload carries on where it left off) and opens a *room* with a 5-letter code.
- **Phones** scan the QR code (or enter the code on the front page) and tap their own name. A phone that sleeps or reloads rejoins as the same player.
- **Connections** use [PeerJS](https://peerjs.com): its free public server only introduces devices; game messages then flow directly between browsers. Players on the same Wi‑Fi connect most reliably. If a phone's network forces a relay, it shows a warning.
- **Narrator**: the host reads the story aloud with [Kokoro](https://github.com/hexgrad/kokoro), a voice model that runs in the browser. It downloads once (about 330 MB with WebGPU, 90 MB without), prepares the game's lines in the background (progress in the 🎙️ Narrator panel), keeps them in memory and plays them on cue. The browser's built-in voice fills in until it's ready.

Keep the host screen open and awake during the game; if it sleeps, play pauses until it's back.

## How a game goes

1. **Setup** (host): add names, set how many of each role, pick the rules and the story.
2. **Lobby**: everyone joins and claims their name.
3. **Roles**: each phone shows its role only while the card is held down. Mafia (and police, if they work together) see their crew.
4. **Night**: roles with an action act first (mafia agree on a kill, police investigate, doctor protects); then everyone answers "who do you suspect?", so every phone ends on the same screen. The night ends by itself.
5. **Morning**: deaths are announced; the anonymous suspicion chart appears.
6. **Day**: discuss with the suspicion chart and yesterday's votes on screen, tap "Ready to vote", then vote. A tie means no elimination or a revote, depending on the rules.
7. Town wins when no mafia are left; mafia win when they equal or outnumber everyone else; the suicide bomber wins alone if voted out.

## Develop

```bash
npm install
npm run dev
```

Open `http://localhost:5174/?host` for the host and the QR link on phones (same Wi‑Fi). `http://localhost:5174/?bots&room=ABCDE&except=YourName` fills the other seats with bots that play randomly.

- `npm test`: engine and host-controller tests
- `npm run typecheck`
- `npm run build`: static site in `dist/web`

Pushing to `main` deploys to GitHub Pages (`.github/workflows/pages.yml`). Optional relay (TURN) servers for phones whose network blocks direct connections: set a repository variable `ICE_SERVERS` to a JSON array of `RTCIceServer` objects. Note that anything in it is visible to anyone who opens the site.

## Code

- `shared/game.ts`: the game engine (pure state changes)
- `shared/views.ts`: what each device is allowed to see
- `shared/host.ts`: the host controller, the "server" running in the host's browser
- `shared/protocol.ts`: messages between phones and host
- `client/src/net/`: PeerJS for the host and the phones
- `client/src/host/`: host screens, narration and the Kokoro voice worker
- `client/src/player/`: phone screens
