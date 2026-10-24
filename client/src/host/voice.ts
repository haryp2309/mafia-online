import type { TtsDevice, TtsRequest, TtsResponse } from './tts.worker';
import { audioContext } from './audio';

/**
 * The narrator's voice. With the Kokoro engine, lines are generated in the background
 * (a worker), kept in memory as audio, and simply played when needed. The browser's own
 * speech is the fallback while the model loads or if it can't run here.
 *
 * Everything goes through one playback queue, one phrase at a time, so lines can never
 * talk over each other.
 */
export const KOKORO_VOICES = [
  { id: 'af_bella', label: 'Bella · sultry (US)' },
  { id: 'af_heart', label: 'Heart · warm (US)' },
  { id: 'bm_george', label: 'George · gentleman (UK)' },
  { id: 'bm_fable', label: 'Fable · storyteller (UK)' },
  { id: 'am_fenrir', label: 'Fenrir · deep (US)' },
  { id: 'am_michael', label: 'Michael · smooth (US)' },
  { id: 'bf_emma', label: 'Emma · elegant (UK)' },
] as const;

export type Engine = 'kokoro' | 'browser';

export interface VoiceSettings {
  engine: Engine;
  kokoroVoice: string;
  /** Browser voice name, when engine is 'browser'. */
  browserVoice: string | null;
  speed: number;
}

export interface VoiceState {
  settings: VoiceSettings;
  model: 'idle' | 'loading' | 'ready' | 'error';
  /** Model download progress, 0..1. */
  download: number;
  /** Voice lines ready in memory for this game, out of how many it needs. */
  prepared: number;
  toPrepare: number;
  error: string | null;
  /** Where the model runs, once loaded. */
  device: TtsDevice | null;
  /** Average seconds to make one line, once measured. */
  secondsPerLine: number | null;
}

const SETTINGS_KEY = 'mafia-voice-v2';
const DEFAULTS: VoiceSettings = { engine: 'kokoro', kokoroVoice: 'af_bella', browserVoice: null, speed: 0.9 };

function loadSettings(): VoiceSettings {
  try {
    return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') as Partial<VoiceSettings>) };
  } catch {
    return DEFAULTS;
  }
}

/** Sentence-sized pieces; the pauses at "…" and full stops make it sound like storytelling. */
export function splitPhrases(text: string): string[] {
  // No lookbehind here: older Safari can't parse it, and this bundle also runs on phones.
  return (text.match(/[^.!?…]+[.!?…]*/g) ?? []).map((p) => p.trim()).filter(Boolean);
}

// ---------- browser speech fallback ----------

const PREFERRED_BROWSER_VOICES = ['Daniel', 'Google UK English Male', 'Microsoft Ryan Online (Natural)', 'Samantha'];
const NOVELTY_VOICES = new Set([
  'Albert', 'Bad News', 'Bahh', 'Bells', 'Boing', 'Bubbles', 'Cellos', 'Good News', 'Jester', 'Organ',
  'Superstar', 'Trinoids', 'Whisper', 'Wobble', 'Zarvox', 'Junior', 'Ralph', 'Kathy', 'Fred',
]);

export function browserVoices(): SpeechSynthesisVoice[] {
  if (!('speechSynthesis' in window)) return [];
  return speechSynthesis.getVoices().filter((v) => v.lang.startsWith('en') && !NOVELTY_VOICES.has(v.name));
}

function pickBrowserVoice(name: string | null): SpeechSynthesisVoice | null {
  const voices = browserVoices();
  return (
    voices.find((v) => v.name === name) ??
    PREFERRED_BROWSER_VOICES.map((n) => voices.find((v) => v.name === n)).find(Boolean) ??
    voices[0] ??
    null
  );
}

// ---------- the narrator ----------

const MAX_QUEUED_PHRASES = 12;

class Narrator {
  private state: VoiceState = {
    settings: loadSettings(),
    model: 'idle',
    download: 0,
    prepared: 0,
    toPrepare: 0,
    error: null,
    device: null,
    secondsPerLine: null,
  };
  private timings: number[] = [];
  private listeners = new Set<() => void>();
  private worker: Worker | null = null;
  private nextId = 1;
  private pending = new Map<number, { key: string; resolve: (b: AudioBuffer | null) => void }>();
  private cache = new Map<string, AudioBuffer>();
  private inflight = new Map<string, Promise<AudioBuffer | null>>();
  /** Lines to generate in the background, most needed first. */
  private backlog: string[] = [];
  private wanted = new Set<string>();
  private generating = false;

  // Playback
  private queue: string[] = [];
  private playing = false;
  private stopToken = 0;

  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  getState = () => this.state;

  private set(patch: Partial<VoiceState>) {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }

  updateSettings(patch: Partial<VoiceSettings>) {
    const settings = { ...this.state.settings, ...patch };
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      // Remembering settings is only a convenience.
    }
    this.set({ settings });
    // A new voice or speed needs its own recordings; re-prepare what this game needs.
    this.backlog = [...this.wanted];
    this.recount();
    if (settings.engine === 'kokoro') this.ensureModel();
  }

  private key(text: string) {
    const s = this.state.settings;
    return `${s.kokoroVoice}|${s.speed}|${text}`;
  }

  private ensureModel() {
    if (this.worker || this.state.model === 'error') return;
    try {
      this.worker = new Worker(new URL('./tts.worker.ts', import.meta.url), { type: 'module' });
    } catch (err) {
      this.set({ model: 'error', error: String(err) });
      return;
    }
    this.set({ model: 'loading' });
    this.worker.onmessage = (e: MessageEvent<TtsResponse>) => this.onWorker(e.data);
    this.worker.onerror = (e) => this.set({ model: 'error', error: e.message || 'The voice model could not start.' });
    void pickDevice().then((device) => this.post({ type: 'load', device }));
  }

  private post(msg: TtsRequest) {
    this.worker?.postMessage(msg);
  }

  private onWorker(msg: TtsResponse) {
    switch (msg.type) {
      case 'progress':
        this.set({ download: msg.total ? msg.loaded / msg.total : 0 });
        break;
      case 'ready':
        this.set({ model: 'ready', download: 1, device: msg.device });
        void this.pump();
        break;
      case 'audio': {
        const job = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (!job) break;
        const ctx = audioContext();
        let buffer: AudioBuffer | null = null;
        if (ctx) {
          buffer = ctx.createBuffer(1, msg.pcm.length, msg.rate);
          buffer.copyToChannel(msg.pcm as Float32Array<ArrayBuffer>, 0);
          this.cache.set(job.key, buffer);
        }
        job.resolve(buffer);
        this.recount();
        break;
      }
      case 'error':
        if (msg.id !== undefined) {
          this.pending.get(msg.id)?.resolve(null);
          this.pending.delete(msg.id);
        } else {
          this.set({ model: 'error', error: msg.message });
        }
        break;
    }
  }

  /** Generate one line (or reuse the one in memory). Resolves null if it can't be made. */
  private generate(text: string): Promise<AudioBuffer | null> {
    const key = this.key(text);
    const hit = this.cache.get(key);
    if (hit) return Promise.resolve(hit);
    const running = this.inflight.get(key);
    if (running) return running;
    this.ensureModel();
    const s = this.state.settings;
    const started = performance.now();
    const promise = new Promise<AudioBuffer | null>((resolve) => {
      const id = this.nextId++;
      this.pending.set(id, {
        key,
        resolve: (b) => {
          this.timings = [...this.timings.slice(-9), (performance.now() - started) / 1000];
          this.set({ secondsPerLine: this.timings.reduce((a, t) => a + t, 0) / this.timings.length });
          resolve(b);
        },
      });
      this.post({ type: 'generate', id, text, voice: s.kokoroVoice, speed: s.speed });
    }).finally(() => this.inflight.delete(key));
    this.inflight.set(key, promise);
    return promise;
  }

  /**
   * Tell the narrator every line this game may need, most urgent first; they're generated in
   * the background. Called again as the game moves on, so the next lines jump the queue.
   */
  prepare(phrases: string[]) {
    this.wanted = new Set(phrases);
    this.backlog = phrases.filter((p) => !this.cache.has(this.key(p)));
    this.recount();
    if (this.state.settings.engine === 'kokoro') {
      this.ensureModel();
      void this.pump();
    }
  }

  private recount() {
    let prepared = 0;
    for (const p of this.wanted) if (this.cache.has(this.key(p))) prepared++;
    this.set({ prepared, toPrepare: this.wanted.size });
  }

  /** Background generation, one line at a time so urgent lines can jump ahead. */
  private async pump() {
    if (this.generating || this.state.model !== 'ready') return;
    this.generating = true;
    try {
      while (this.backlog.length && this.state.settings.engine === 'kokoro') {
        const next = this.backlog.shift()!;
        if (this.cache.has(this.key(next))) continue;
        await this.generate(next);
      }
    } finally {
      this.generating = false;
    }
  }

  // ---------- playback ----------

  speak(text: string) {
    const phrases = splitPhrases(text);
    // New lines wait their turn; only a big backlog (phases racing past) is dropped.
    this.queue = this.queue.length + phrases.length > MAX_QUEUED_PHRASES ? phrases : [...this.queue, ...phrases];
    void this.play();
  }

  stop() {
    this.stopToken++;
    this.queue = [];
    this.playing = false;
    this.currentSource?.stop();
    this.currentSource = null;
    if ('speechSynthesis' in window) speechSynthesis.cancel();
  }

  private currentSource: AudioBufferSourceNode | null = null;

  private async play() {
    if (this.playing) return;
    this.playing = true;
    const token = this.stopToken;
    while (this.queue.length && token === this.stopToken) {
      const phrase = this.queue.shift()!;
      const useKokoro = this.state.settings.engine === 'kokoro' && this.state.model !== 'error';
      const buffer = useKokoro && this.state.model === 'ready' ? await withTimeout(this.generate(phrase), 8000) : null;
      if (token !== this.stopToken) break;
      if (buffer) await this.playBuffer(buffer);
      else await this.speakWithBrowser(phrase);
    }
    if (token === this.stopToken) this.playing = false;
  }

  private playBuffer(buffer: AudioBuffer): Promise<void> {
    const ctx = audioContext();
    if (!ctx) return Promise.resolve();
    return new Promise((resolve) => {
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(ctx.destination);
      src.onended = () => resolve();
      this.currentSource = src;
      src.start();
      // Safety net in case "ended" never fires.
      setTimeout(resolve, buffer.duration * 1000 + 1500);
    });
  }

  private speakWithBrowser(phrase: string): Promise<void> {
    if (!('speechSynthesis' in window)) return Promise.resolve();
    return new Promise((resolve) => {
      const u = new SpeechSynthesisUtterance(phrase);
      const voice = pickBrowserVoice(this.state.settings.browserVoice);
      if (voice) {
        u.voice = voice;
        u.lang = voice.lang;
      }
      u.rate = 0.82;
      u.pitch = 0.75;
      u.onend = () => resolve();
      u.onerror = () => resolve();
      speechSynthesis.speak(u);
      setTimeout(resolve, 4000 + phrase.length * 150);
    });
  }
}

/** WebGPU when the browser has it (much faster), otherwise multi-threaded WASM on the CPU. */
async function pickDevice(): Promise<TtsDevice> {
  try {
    const forced = localStorage.getItem('mafia-tts-device');
    if (forced === 'webgpu' || forced === 'wasm') return forced;
  } catch {
    // Ignore; auto-detect below.
  }
  try {
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
    if (gpu && (await gpu.requestAdapter())) return 'webgpu';
  } catch {
    // No usable GPU.
  }
  return 'wasm';
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([p, new Promise<null>((r) => setTimeout(() => r(null), ms))]);
}

export const narrator = new Narrator();
