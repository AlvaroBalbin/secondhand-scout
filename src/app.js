import { validateProfile, makeResult, InputError } from "./engine.js";
import { discover, importListings, ProviderError } from "./provider.js";
import { demoItems } from "./demo.js";
import { normalizeListings } from "./listings.js";
import { readFeed, searchFeed } from "./feed.js";

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
const cache = new Map();
let busy = false,
  lastSearch = 0;
export async function api(request) {
  const path = new URL(request.url).pathname;
  if (path === "/api/health")
    return json({ ok: true, version: "0.1.0", marketplace: "uk" });
  if (!["/api/search", "/api/demo", "/api/import", "/api/rank"].includes(path))
    return json({ error: "Not found" }, 404);
  if (request.method !== "POST") return json({ error: "Use POST" }, 405);
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin)
    return json({ error: "Use this app’s own search form." }, 403);
  try {
    const raw = await request.text();
    if (raw.length > 32768)
      return json({ error: "Request exceeds 32 KB." }, 413);
    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      throw new InputError("The shopping brief could not be read.");
    }
    const profile = validateProfile(body?.profile);
    if (path === "/api/demo")
      return json(
        makeResult(demoItems(profile), profile, {
          mode: "demo",
          source: "Synthetic examples",
          warnings: [],
          limits: "Example prices and listings.",
        }),
      );
    if (path === "/api/rank")
      return json(
        makeResult(normalizeListings(body.listings), profile, {
          mode: "manual",
          source: "Supplied listings",
          warnings: [],
          limits:
            "Availability, label photos and condition depend on the supplied information.",
        }),
      );
    if (path === "/api/search" && process.env.SCOUT_FEED_FILE) {
      try {
        const state = await readFeed(process.env.SCOUT_FEED_FILE);
        const found = searchFeed(state, { profile, maxAgeMinutes: Number(process.env.SCOUT_FEED_MAX_AGE_MINUTES || 60) });
        return json(makeResult(found.items, profile, found.meta, found.comparables));
      } catch {
        return json({ error: "The configured listing feed is unavailable or stale. Refresh it before searching.", type: "provider_unavailable" }, 503);
      }
    }
    const key = JSON.stringify({ path, profile, links: body.links });
    const hit = cache.get(key);
    if (hit && Date.now() - hit.time < 300000)
      return json({
        ...hit.result,
        meta: { ...hit.result.meta, cached: true },
      });
    if (busy || Date.now() - lastSearch < 15000)
      return json(
        {
          error:
            "A live search is already running or has just finished. Please wait a moment.",
        },
        429,
      );
    busy = true;
    lastSearch = Date.now();
    try {
      const found =
        path === "/api/import"
          ? await importListings(profile, body.links)
          : await discover(profile);
      const result = makeResult(found.items, profile, found.meta, found.comparables);
      if (cache.size >= 20) cache.delete(cache.keys().next().value);
      cache.set(key, { time: Date.now(), result });
      return json(result);
    } finally {
      busy = false;
      lastSearch = Date.now();
    }
  } catch (e) {
    return json(
      {
        error:
          e instanceof InputError || e instanceof ProviderError
            ? e.message
            : "The search could not finish. Try again later.",
        type:
          e instanceof ProviderError
            ? "provider_unavailable"
            : "invalid_request",
      },
      e instanceof InputError ? 400 : 503,
    );
  }
}
