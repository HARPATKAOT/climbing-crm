import { useEffect, useRef } from 'react';

/**
 * Wait for the next stored message instead of asking on a timer.
 *
 * One request goes out and the server holds it until a message is actually
 * written, so a customer's reply shows the moment it lands. A hidden tab stops
 * waiting, and the slow interval stays as a safety net for a server restart or
 * a dropped connection.
 *
 * @param {() => void} onChange  called when something was stored
 * @param {{ enabled?: boolean, safetyMs?: number }} options
 */
export function useLiveMessages(onChange, { enabled = true, safetyMs = 20000 } = {}) {
  const handlerRef = useRef(onChange);
  handlerRef.current = onChange;

  useEffect(() => {
    if (!enabled) return undefined;
    let stopped = false;
    let version = 0;
    let controller = null;
    let looping = false;

    const waitLoop = async () => {
      if (looping) return;
      looping = true;
      try {
        while (!stopped) {
          if (document.visibilityState !== 'visible') return;
          controller = new AbortController();
          try {
            const res = await fetch('/api/updates/messages', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ since: version }),
              signal: controller.signal,
            });
            if (stopped) return;
            if (!res.ok) {
              await new Promise((r) => setTimeout(r, 5000));
              continue;
            }
            const body = await res.json().catch(() => ({}));
            if (Number.isFinite(body.version)) version = body.version;
            if (body.changed && !stopped) handlerRef.current?.();
          } catch {
            if (stopped) return;
            await new Promise((r) => setTimeout(r, 3000));
          }
        }
      } finally {
        looping = false;
      }
    };

    const onVisibility = () => {
      if (document.visibilityState !== 'visible') {
        controller?.abort();
        return;
      }
      handlerRef.current?.();
      waitLoop();
    };

    waitLoop();
    const safety = setInterval(() => {
      if (document.visibilityState === 'visible') handlerRef.current?.();
    }, safetyMs);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      stopped = true;
      controller?.abort();
      clearInterval(safety);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [enabled, safetyMs]);
}

export default useLiveMessages;
