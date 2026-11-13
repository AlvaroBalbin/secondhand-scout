import { setTimeout as sleep } from "node:timers/promises";

export class LiveQueueFull extends Error {}

// Keep one marketplace job active. Queued jobs expire before the client's HTTP timeout.
export function createLiveQueue({ waitMs = 45_000, spacingMs = 2200, maxWaiting = 4 } = {}) {
  const waiting = [];
  let active = false;
  let nextStart = 0;

  async function drain() {
    if (active) return;
    active = true;
    try {
      while (waiting.length) {
        const delay = nextStart - Date.now();
        if (delay > 0) await sleep(delay);
        const entry = waiting.shift();
        if (!entry) break;
        clearTimeout(entry.timeout);
        try { entry.resolve(await entry.run()); }
        catch (error) { entry.reject(error); }
        nextStart = Date.now() + spacingMs;
      }
    } finally {
      active = false;
    }
  }

  return (run) => new Promise((resolve, reject) => {
    if (waiting.length >= maxWaiting) return reject(new LiveQueueFull());
    const entry = { run, resolve, reject };
    entry.timeout = setTimeout(() => {
      const index = waiting.indexOf(entry);
      if (index !== -1) waiting.splice(index, 1);
      reject(new LiveQueueFull());
    }, waitMs);
    waiting.push(entry);
    void drain();
  });
}
