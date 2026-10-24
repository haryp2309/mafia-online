import { useEffect, useState } from 'react';
import { serverNow } from './net/send';

export { send, serverNow } from './net/send';

export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(serverNow());
  useEffect(() => {
    const t = setInterval(() => setNow(serverNow()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

/** Keep the screen awake during the game. Needs a tap first in some browsers. */
export function useWakeLock() {
  useEffect(() => {
    let lock: WakeLockSentinel | null = null;
    const request = async () => {
      try {
        if (document.visibilityState === 'visible' && 'wakeLock' in navigator && !lock) {
          lock = await navigator.wakeLock.request('screen');
          lock.addEventListener('release', () => (lock = null));
        }
      } catch {
        // Not supported or not allowed yet; we retry on the next tap.
      }
    };
    void request();
    document.addEventListener('visibilitychange', request);
    document.addEventListener('pointerdown', request);
    return () => {
      document.removeEventListener('visibilitychange', request);
      document.removeEventListener('pointerdown', request);
      void lock?.release();
    };
  }, []);
}
