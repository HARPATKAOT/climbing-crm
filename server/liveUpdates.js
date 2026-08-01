/**
 * "Did anything change?" without polling every second.
 *
 * The conversation panel used to re-fetch the whole thread on a timer, so a
 * customer's reply took up to a second and a half to show and every open screen
 * hit the API 40 times a minute. Here a request simply waits until something is
 * actually written, and returns immediately when it is.
 *
 * In process memory on purpose: one API instance serves the wall, and a missed
 * notification costs one slow refresh, not a lost message.
 */

let version = 0;
const waiters = new Set();

/** Called wherever a message is stored. Wakes every waiting request. */
export function noteMessagesChanged() {
  version += 1;
  const current = version;
  for (const waiter of [...waiters]) {
    waiters.delete(waiter);
    waiter(current);
  }
}

export function currentVersion() {
  return version;
}

/**
 * Resolve as soon as the version moves past `since`, or on timeout.
 * @returns {Promise<{ version: number, changed: boolean }>}
 */
export function waitForMessages({ since = 0, timeoutMs = 25000 } = {}) {
  const from = Number(since) || 0;
  if (version > from) return Promise.resolve({ version, changed: true });

  return new Promise((resolve) => {
    let done = false;
    const finish = (changed) => {
      if (done) return;
      done = true;
      waiters.delete(waiter);
      clearTimeout(timer);
      resolve({ version, changed });
    };
    const waiter = () => finish(true);
    const timer = setTimeout(() => finish(false), Math.max(1000, Math.min(60000, timeoutMs)));
    // A timer must never hold the process open on shutdown.
    if (typeof timer.unref === 'function') timer.unref();
    waiters.add(waiter);
  });
}

/** Tests and shutdown: drop everyone still waiting. */
export function releaseAllWaiters() {
  for (const waiter of [...waiters]) {
    waiters.delete(waiter);
    waiter(version);
  }
}
