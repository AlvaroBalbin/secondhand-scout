import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { verifyBasket } from "../scripts/verify.mjs";
import { shop } from "../scripts/shop.mjs";
import { validateProfile } from "../src/engine.js";
import { discover } from "../src/provider.js";
import { applyFeed } from "../src/feed.js";
import { listingGallery } from "../src/provider.js";
import { createLiveQueue, LiveQueueFull } from "../src/live-queue.js";

test("gallery returns ordered listing photos rather than other page images", () => {
  const first = "https://images1.vinted.net/front.webp";
  const second = "https://images1.vinted.net/label.webp?a=1&b=2";
  const html = `<img src="https://images1.vinted.net/avatar.webp" data-testid="avatar">
    <img data-testid="item-photo-2--img" src="${second.replace("&", "&amp;")}">
    <img src="${first}" data-testid="item-photo-1--img">
    <img src="${first}" data-testid="item-photo-1--img">
    <img src="https://example.com/third.webp" data-testid="item-photo-3--img">`;
  assert.deepEqual(listingGallery(html, first), { urls: [first, second], source: "listing_gallery" });
  assert.deepEqual(listingGallery("", first), { urls: [first], source: "listing_metadata" });
});

test("live queue serializes follow-ups and rejects excess requests without running them", async () => {
  const queue = createLiveQueue({ maxWaiting: 1, spacingMs: 0 });
  let finish;
  const first = queue(() => new Promise(resolve => { finish = resolve; }));
  let ran = false;
  const second = queue(() => { ran = true; return "second"; });
  await assert.rejects(queue(() => assert.fail("excess request ran")), LiveQueueFull);
  assert.equal(ran, false);
  finish("first");
  assert.deepEqual(await Promise.all([first, second]), ["first", "second"]);
});

const profile = { wants: { shirts: 1 }, collar: 41, budget: 50, brands: "Hackett" };
const shirt = { id: "shirt", kind: "shirts", title: "Hackett regular fit shirt", price: 12, fee: 1.3,
  sellerId: "seller", currency: "GBP", brand: "Hackett", size: "16.5 in | 41 cm",
  url: "https://www.vinted.co.uk/items/10000000000-shirt", available: true, description: "" };

test("deep discovery tries alternate wording within the catalogue query cap", async () => {
  const brief = validateProfile({ ...profile, brands: "Hackett, Ralph Lauren",
    styleByKind: { shirts: { search: "regular fit" } } });
  const queries = [];
  const client = { pageGet: async (_country, path) => {
    queries.push(new URL(path, "https://www.vinted.co.uk").searchParams.get("search_text"));
    return { items: [], pagination: {} };
  } };
  const found = await discover(brief, { client, deep: true });
  assert.equal(found.meta.queryCount, 7);
  assert.equal(queries.length, 7);
  assert.ok(queries.some(query => query === "Hackett button down shirt 16.5"));
});

test("finalist verification recalculates complete fresh totals and preserves unknown photo evidence", async () => {
  const found = await verifyBasket({ profile, basket: [shirt] }, [shirt.id], {
    client: {}, read: async () => ({ ...shirt, price: 10, fee: 1.2, title: "Hackett shirt",
      photoUrls: ["https://images1.vinted.net/example.webp"] }),
  });
  assert.equal(found.recheckedCost.total, 15.7);
  assert.equal(found.checks[0].priceChanged, true);
  assert.equal(found.checks[0].photos.status, "unreviewed");
  assert.deepEqual(found.checks[0].questions, ["What cut is printed on the shirt label?"]);
  const unavailable = await verifyBasket({ profile, basket: [shirt] }, [shirt.id], {
    client: {}, read: async () => ({ ...shirt, available: false }),
  });
  assert.equal(unavailable.checks[0].status, "unavailable");
  assert.equal(unavailable.recheckedCost, null);
});

test("purchase and fit outcomes survive independent saves and teach cut without changing sizing", async (t) => {
  const directory = await mkdtemp(join(process.cwd(), "scout-upgrade-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const state = join(directory, "taste.json");
  const search = listings => shop({ profile, listings }, state);
  const first = await search([shirt]);
  await shop({ action: "outcome", number: first.picks[0].number, outcome: "bought" }, state);
  await shop({ action: "outcome", id: shirt.id, outcome: "too tight", fitArea: "chest" }, state);
  await shop({ action: "save", id: shirt.id }, state);
  const outcome = await shop({ action: "outcome", id: shirt.id, outcome: "fits", fitArea: "chest" }, state);
  assert.deepEqual(outcome.taste.outcomes.map(({ reason, fitArea }) => [reason, fitArea]),
    [["fits", "chest"], ["bought", undefined]]);
  const next = await search([shirt, { ...shirt, id: "next", url: null },
    { ...shirt, id: "wrong", url: null, size: "17 in | 42 cm", price: 1 }]);
  assert.equal(next.basket.items[0].id, "next");
  assert.ok(next.basket.items[0].tasteEvidence.some(({ source, value }) => source === "fits" && value === "regular fit"));
  const expanded = await shop({ action: "explore", listings: [
    next.basket.items[0], { ...shirt, id: "alternative", url: null },
  ] }, state);
  assert.deepEqual(expanded.basket.items.map(({ id }) => id), ["next"]);
  assert.deepEqual(expanded.preview.items.map(({ id }) => id), ["alternative"]);
  assert.deepEqual(expanded.picks.find(({ id }) => id === "next"), next.picks.find(({ id }) => id === "next"));
});

test("hosted HTTP search reads fresh feed, enforces token and fails closed on stale data", { timeout: 8000 }, async (t) => {
  const directory = await mkdtemp(join(process.cwd(), "scout-http-test-"));
  const file = join(directory, "feed.json");
  const batch = JSON.parse(await readFile(new URL("../examples/feed-snapshot.json", import.meta.url), "utf8"));
  const fresh = applyFeed(null, { ...batch, capturedAt: new Date().toISOString() });
  await writeFile(file, JSON.stringify(fresh));
  const child = spawn(process.execPath, ["scripts/dev.mjs", "--hosted"], {
    env: { ...process.env, PORT: "0", SCOUT_HOST: "127.0.0.1", SCOUT_FEED_FILE: file,
      SCOUT_SEARCH_TOKEN: "test-token", SCOUT_FEED_MAX_AGE_MINUTES: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(async () => {
    if (child.exitCode === null) { const ended = once(child, "exit"); child.kill(); await ended; }
    await rm(directory, { recursive: true, force: true });
  });
  const [data] = await once(child.stdout, "data", { signal: AbortSignal.timeout(3000) });
  const endpoint = data.toString().match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
  assert.ok(endpoint);
  const search = token => fetch(endpoint + "/v1/search", { method: "POST", headers: {
    "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}),
  }, body: JSON.stringify({ profile: { wants: { jumpers: 1 }, sizes: "L", budget: 50 }, depth: "deep" }) });
  assert.equal((await search()).status, 401);
  const guide = await fetch(endpoint + "/start");
  assert.equal(guide.status, 200);
  assert.match(guide.headers.get("content-type"), /^text\/plain/);
  assert.match(await guide.text(), /POST \/v1\/search/);
  assert.equal((await fetch(endpoint + "/api/demo")).status, 404);
  const response = await search("test-token");
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.meta.mode, "feed");
  assert.equal(result.meta.depth, "deep");
  assert.equal(result.basket.items[0].id, "example-listing");
  const keep = token => fetch(endpoint + "/v1/follow-up", { method: "POST", headers: {
    "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}),
  }, body: JSON.stringify({ session: result.session, keep: [1] }) });
  assert.equal((await keep()).status, 401);
  const kept = await (await keep("test-token")).json();
  assert.equal(kept.picks[0].saved, true);
  assert.equal(kept.basket.cost.total, result.basket.cost.total);
  await writeFile(file, JSON.stringify({ ...fresh, capturedAt: "2020-01-01T00:00:00Z" }));
  assert.equal((await search("test-token")).status, 503);
});
