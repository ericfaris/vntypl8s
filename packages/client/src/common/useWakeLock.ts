import { useEffect } from 'react';

/**
 * Keeps the screen from sleeping while `active`. Players compose plates and
 * then guess out loud, so a phone can sit untouched well past its auto-lock
 * timeout. The Wake Lock API auto-releases when the tab is backgrounded, so
 * re-acquire on visibilitychange.
 */
export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active || !('wakeLock' in navigator)) return;

    let sentinel: WakeLockSentinel | null = null;
    let cancelled = false;

    const acquire = async () => {
      try {
        const lock = await navigator.wakeLock.request('screen');
        if (cancelled) {
          void lock.release();
          return;
        }
        sentinel = lock;
      } catch {
        // Not fatal — denied, or the device doesn't really support it.
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible' && !sentinel) void acquire();
    };

    void acquire();
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibilityChange);
      void sentinel?.release();
    };
  }, [active]);
}
