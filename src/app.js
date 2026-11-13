import { validateProfile, makeResult, InputError } from "./engine.js";
import { discover, importListings, ProviderError } from "./provider.js";
import { demoItems } from "./demo.js";
import { normalizeListings } from "./listings.js";
import { readFeed, searchFeed } from "./feed.js";
import { prepareFollowUp, startShopping } from "./hosted-shopping.js";
import { hostedProfile, requestCorrection } from "./hosted-contract.js";
import { readResumeCode } from "./hosted-resume.js";
import { personalRanking } from "./taste.js";
import { createLiveQueue, LiveQueueFull } from "./live-queue.js";

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...headers,
    },
  });
const cache = new Map();
const queue = createLiveQueue();
const inFlight = new Map();
export async function api(request, rankingOptions = {}, hosted = false) {
  const path = new URL(request.url).pathname;
  if (path === "/api/health")
    return json({ ok: true, version: "0.1.0", marketplace: "uk" });
  if (!["/api/search", "/api/demo", "/api/import", "/api/rank"].includes(path) &&
      !(hosted && path === "/api/follow-up"))
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
    if (path === "/api/follow-up") {
      const followUp = prepareFollowUp(body);
      if (!followUp.search) return json(await followUp.run());
      if (process.env.SCOUT_FEED_FILE)
        return json({ error: "Live replacement search is unavailable in feed mode." }, 503);
      return json(await queue(followUp.run));
    }
    const rawProfile = hosted ? hostedProfile(body?.profile) : body?.profile;
    const profile = validateProfile(rawProfile);
    const feedback = hosted && body.resume ? readResumeCode(body.resume).feedback ?? [] : [];
    if (feedback.length) rankingOptions = { ...rankingOptions, personal: personalRanking(feedback, null, [], rawProfile) };
    const respond = (result) => json(hosted && path === "/api/search" ? startShopping(rawProfile, result, feedback) : result);
    const personalized = rankingOptions.personal || rankingOptions.nearMatches;
    if (path === "/api/search" && profile.fitByKind.jackets?.pitToPitCm) {
      rankingOptions = { ...rankingOptions, nearMatches: true };
    }
    const deep = body.depth === "deep";
    if (path === "/api/demo")
      return json(
        makeResult(demoItems(profile), profile, {
          mode: "demo",
          source: "Synthetic examples",
          warnings: [],
          limits: "Example prices and listings.",
        }, undefined, rankingOptions),
      );
    if (path === "/api/rank")
      return json(
        makeResult(normalizeListings(body.listings), profile, {
          mode: "manual",
          source: "Supplied listings",
          warnings: [],
          limits:
            "Availability, label photos and condition depend on the supplied information.",
        }, undefined, rankingOptions),
      );
    if (path === "/api/search" && process.env.SCOUT_FEED_FILE) {
      try {
        const state = await readFeed(process.env.SCOUT_FEED_FILE);
        const found = searchFeed(state, { profile, deep, preview: rankingOptions.nearMatches,
          maxAgeMinutes: Number(process.env.SCOUT_FEED_MAX_AGE_MINUTES || 60) });
        return respond(makeResult(found.items, profile, found.meta, found.comparables, rankingOptions));
      } catch {
        return json({ error: "The configured listing feed is unavailable or stale. Refresh it before searching.", type: "provider_unavailable" }, 503);
      }
    }
    const key = JSON.stringify({ path, profile, links: body.links, deep });
    const hit = personalized ? null : cache.get(key);
    if (hit && Date.now() - hit.time < 300000)
      return respond({
        ...hit.result,
        meta: { ...hit.result.meta, cached: true },
      });
    const shared = personalized ? null : inFlight.get(key);
    if (shared) return respond(await shared);
    const job = queue(async () => {
      const found =
        path === "/api/import"
          ? await importListings(profile, body.links)
          : await discover(profile, { preview: rankingOptions.nearMatches, deep, excludeIds: rankingOptions.excludeIds,
            personal: rankingOptions.personal });
      const result = makeResult(found.items, profile, found.meta, found.comparables, rankingOptions);
      if (!personalized) {
        if (cache.size >= 20) cache.delete(cache.keys().next().value);
        cache.set(key, { time: Date.now(), result });
      }
      return result;
    });
    if (!personalized) inFlight.set(key, job);
    try {
      return respond(await job);
    } finally {
      if (!personalized) inFlight.delete(key);
    }
  } catch (e) {
    if (e instanceof LiveQueueFull)
      return json({ error: "Scout is handling other live requests. Retry in 10 seconds.",
        type: "queue_full" }, 503, { "Retry-After": "10" });
    return json(
      {
        error:
          e instanceof InputError || e instanceof ProviderError
            ? e.message
            : "The search could not finish. Try again later.",
        ...(hosted ? requestCorrection(e) : {}),
        type:
          e instanceof ProviderError
            ? "provider_unavailable"
            : "invalid_request",
      },
      e instanceof InputError ? 400 : 503,
    );
  }
}
