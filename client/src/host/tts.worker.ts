/// <reference lib="webworker" />
import { KokoroTTS } from 'kokoro-js';

/**
 * Runs the Kokoro voice model off the main thread so the host screen stays smooth.
 * The model downloads once (about 90 MB for the CPU, 330 MB for WebGPU) and is cached.
 */
export type TtsDevice = 'webgpu' | 'wasm';
export type TtsRequest =
  | { type: 'load'; device: TtsDevice }
  | { type: 'generate'; id: number; text: string; voice: string; speed: number };
export type TtsResponse =
  | { type: 'progress'; loaded: number; total: number }
  | { type: 'ready'; device: TtsDevice }
  | { type: 'error'; message: string; id?: number }
  | { type: 'audio'; id: number; pcm: Float32Array; rate: number };

const MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX';
let tts: Promise<KokoroTTS> | null = null;
const files = new Map<string, { loaded: number; total: number }>();

const post = (msg: TtsResponse, transfer: Transferable[] = []) => (self as DedicatedWorkerGlobalScope).postMessage(msg, transfer);

let device: TtsDevice = 'wasm';

function load(wanted?: TtsDevice) {
  if (wanted) device = wanted;
  // WebGPU is much faster but needs the full-precision model; WASM uses the compact one.
  tts ??= KokoroTTS.from_pretrained(MODEL, {
    dtype: device === 'webgpu' ? 'fp32' : 'q8',
    device,
    progress_callback: (info: { status: string; file?: string; loaded?: number; total?: number }) => {
      if (info.status !== 'progress' || !info.file || !info.total) return;
      files.set(info.file, { loaded: info.loaded ?? 0, total: info.total });
      let loaded = 0;
      let total = 0;
      for (const f of files.values()) {
        loaded += f.loaded;
        total += f.total;
      }
      post({ type: 'progress', loaded, total });
    },
  });
  return tts;
}

self.onmessage = async (e: MessageEvent<TtsRequest>) => {
  const msg = e.data;
  try {
    if (msg.type === 'load') {
      try {
        await load(msg.device);
      } catch (err) {
        if (device !== 'webgpu') throw err;
        // WebGPU didn't work out on this machine; fall back to the CPU.
        tts = null;
        files.clear();
        await load('wasm');
      }
      post({ type: 'ready', device });
    } else if (msg.type === 'generate') {
      const model = await load();
      const audio = await model.generate(msg.text, { voice: msg.voice as never, speed: msg.speed });
      const pcm = audio.audio as Float32Array;
      post({ type: 'audio', id: msg.id, pcm, rate: audio.sampling_rate }, [pcm.buffer as ArrayBuffer]);
    }
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err), id: msg.type === 'generate' ? msg.id : undefined });
  }
};
