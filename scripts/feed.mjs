import { readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { fetchFeedBatch, syncFeed } from "../src/feed.js";

try {
  const [command, statePath, batchPath] = process.argv.slice(2);
  const endpoint = process.env.SCOUT_FEED_URL;
  if (!statePath || (command === "sync" ? !batchPath && !endpoint :
      command !== "watch" || batchPath || !endpoint))
    throw new Error("Run node scripts/feed.mjs sync STATE.json [BATCH.json] or watch STATE.json. Set SCOUT_FEED_URL for HTTPS.");
  async function sync() {
    const state = await syncFeed(statePath, (cursor) => batchPath
      ? readFile(batchPath, "utf8").then(JSON.parse)
      : fetchFeedBatch(endpoint, { cursor, token: process.env.SCOUT_FEED_TOKEN }));
    console.log(JSON.stringify({ source: state.source, capturedAt: state.capturedAt,
      listings: state.records.length, available: state.records.filter((row) => row.listing.available).length }));
  }
  if (command === "sync") await sync();
  else {
    const seconds = Number(process.env.SCOUT_FEED_POLL_SECONDS || 120);
    if (!Number.isFinite(seconds) || seconds < 30 || seconds > 86_400)
      throw new Error("Choose a feed poll interval from 30 to 86400 seconds.");
    const stop = new AbortController();
    process.once("SIGINT", () => stop.abort());
    process.once("SIGTERM", () => stop.abort());
    let failures = 0;
    while (!stop.signal.aborted) {
      try {
        await sync();
        failures = 0;
      } catch (error) {
        const retryable = error.status >= 500 || error.name === "TimeoutError";
        if (!retryable || ++failures >= 3) throw error;
        console.error(error.message);
      }
      await delay(seconds * 1000 * (1 + failures), undefined, { signal: stop.signal })
        .catch((error) => { if (error.name !== "AbortError") throw error; });
    }
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
