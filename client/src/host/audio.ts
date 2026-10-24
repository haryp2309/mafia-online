/**
 * Synthesised atmosphere for the host screen: a low drone with a heartbeat at night, and a
 * deep boom when a death is revealed. No audio files needed.
 */
let ctx: AudioContext | null = null;
let night: { stop: () => void } | null = null;

/** The shared audio output (also used to play the narrator's voice lines). */
export function audioContext(): AudioContext | null {
  if (!ctx) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

/** Browsers only allow sound after a tap or click, so unlock on the host's first one. */
export function unlockAudioOnGesture() {
  const unlock = () => audioContext();
  document.addEventListener('pointerdown', unlock, { once: true });
  return () => document.removeEventListener('pointerdown', unlock);
}

function thump(ac: AudioContext, out: AudioNode, at: number, gain: number) {
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.frequency.setValueAtTime(70, at);
  osc.frequency.exponentialRampToValueAtTime(40, at + 0.15);
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(gain, at + 0.02);
  g.gain.exponentialRampToValueAtTime(0.001, at + 0.25);
  osc.connect(g).connect(out);
  osc.start(at);
  osc.stop(at + 0.3);
}

export function startNightAmbience() {
  const ac = audioContext();
  if (!ac || night) return;
  const master = ac.createGain();
  master.gain.setValueAtTime(0, ac.currentTime);
  master.gain.linearRampToValueAtTime(0.5, ac.currentTime + 3);
  master.connect(ac.destination);

  // Two slightly detuned low tones through a low-pass filter make a slow, uneasy drone.
  const filter = ac.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 180;
  filter.connect(master);
  const drones = [55, 55.7, 82.4].map((f) => {
    const osc = ac.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = f;
    const g = ac.createGain();
    g.gain.value = 0.05;
    osc.connect(g).connect(filter);
    osc.start();
    return osc;
  });

  // Heartbeat: lub-dub every 1.3 seconds.
  let next = ac.currentTime + 1;
  const beat = setInterval(() => {
    while (next < ac.currentTime + 1.5) {
      thump(ac, master, next, 0.6);
      thump(ac, master, next + 0.22, 0.4);
      next += 1.3;
    }
  }, 300);

  night = {
    stop: () => {
      clearInterval(beat);
      master.gain.cancelScheduledValues(ac.currentTime);
      master.gain.setValueAtTime(master.gain.value, ac.currentTime);
      master.gain.linearRampToValueAtTime(0, ac.currentTime + 2);
      setTimeout(() => {
        drones.forEach((d) => d.stop());
        master.disconnect();
      }, 2200);
    },
  };
}

export function stopNightAmbience() {
  night?.stop();
  night = null;
}

/** A deep falling boom for a dramatic reveal. */
export function sting() {
  const ac = audioContext();
  if (!ac) return;
  const t = ac.currentTime;
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(110, t);
  osc.frequency.exponentialRampToValueAtTime(30, t + 2);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.7, t + 0.05);
  g.gain.exponentialRampToValueAtTime(0.001, t + 2.5);
  osc.connect(g).connect(ac.destination);
  osc.start(t);
  osc.stop(t + 2.6);
}
