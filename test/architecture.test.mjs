import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rmdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { assessFit, makeResult, validateProfile } from "../src/engine.js";
import { discover } from "../src/provider.js";
import { applyFeed, fetchFeedBatch, readFeed, searchFeed, syncFeed } from "../src/feed.js";

const mixed = {
  wants: { shirts: 1, jumpers: 1, trousers: 1 },
  fitByKind: {
    shirts: { collarCm: 41 },
    jumpers: { sizes: ["L"], pitToPitCm: [53, 57] },
    trousers: { waistIn: 34, inseamIn: [30, 32] },
  },
  budget: 60,
};

test("garment fit uses separate evidence and keeps explicit contradictions out", () => {
  const profile = validateProfile(mixed);
  assert.equal(assessFit({ kind: "shirts", title: "Oxford shirt", size: "41" }, profile).status, "match");
  const jumper = { kind: "jumpers", title: "Merino jumper", size: "L" };
  assert.equal(assessFit(jumper, profile).status, "unknown");
  assert.equal(assessFit({ ...jumper, description: "Pit to pit 22 in." }, profile).status, "match");
  assert.equal(assessFit({ ...jumper, description: "Chest circumference 55 cm." }, profile).status, "unknown");
  const trousers = { kind: "trousers", title: "Chinos", size: "W34L32" };
  assert.equal(assessFit(trousers, profile).status, "match");
  assert.equal(assessFit({ ...trousers, description: "Waist measures 30 in." }, profile).status, "excluded");
  assert.throws(() => validateProfile({
    ...mixed, fitByKind: { ...mixed.fitByKind, jumpers: { waistIn: 34 } },
  }), /Unsupported fit/);
});

test("agent style preferences influence only the requested garment and need listing evidence", () => {
  const profile = validateProfile({
    wants: { jackets: 1, jumpers: 1 }, sizes: "L", budget: 60, delivery: 0,
    styleByKind: { jackets: { search: "waxed", prefer: ["waxed", "corduroy collar"] } },
  });
  const row = { size: "L", price: 15, condition: "Very good", currency: "GBP", fee: 0 };
  const result = makeResult([
    { ...row, id: "generic", kind: "jackets", title: "Outdoor jacket" },
    { ...row, id: "match", kind: "jackets", title: "Waxed jacket", price: 17,
      description: "Corduroy collar." },
    { ...row, id: "negative", kind: "jackets", title: "Outdoor jacket",
      description: "Not waxed. No corduroy collar." },
    { ...row, id: "jumper", kind: "jumpers", title: "Merino jumper",
      description: "Corduroy collar." },
  ], profile);
  assert.equal(result.basket.items.find((item) => item.kind === "jackets").id, "match");
  assert.deepEqual(result.basket.items.find((item) => item.id === "match").styleEvidence, [
    { term: "waxed", field: "title", excerpt: "Waxed" },
    { term: "corduroy collar", field: "description", excerpt: "Corduroy collar" },
  ]);
  assert.deepEqual(result.items.find((item) => item.id === "negative").styleEvidence, []);
  assert.deepEqual(result.items.find((item) => item.id === "jumper").styleEvidence, []);
  assert.throws(() => validateProfile({
    wants: { jackets: 1 }, sizes: "L", budget: 60,
    styleByKind: { jackets: { prefer: ["(waxed.*)"] } },
  }), /short clothing phrases/);
});

test("focused queries retain broad search and stay inside the existing follow-up cap", async () => {
  const profile = validateProfile({
    wants: { jackets: 1 }, sizes: "L", budget: 50,
    styleByKind: { jackets: { search: "waxed", prefer: ["waxed"] } },
  });
  const calls = [];
  const client = { pageGet: async (_country, path) => {
    const params = new URL(path, "https://www.vinted.co.uk").searchParams;
    calls.push([params.get("search_text"), params.get("order")]);
    return { items: [], pagination: {} };
  } };
  await discover(profile, { client });
  assert.deepEqual(calls, [["jacket", "relevance"], ["jacket waxed", "relevance"], ["jacket", "price_asc"]]);
});

test("seller trouser dimensions, UK shoe sizing and measured jacket near matches", () => {
  const trousers = validateProfile({ wants: { trousers: 1 }, budget: 45,
    fitByKind: { trousers: { waistIn: 34, inseamIn: 30 } } });
  const pair = { kind: "trousers", title: "Chinos W34 L30", size: "W34" };
  assert.equal(assessFit(pair, trousers).status, "match");
  assert.equal(assessFit({ ...pair, description: 'Inside Leg Length - 32"' }, trousers).status, "excluded");
  assert.equal(assessFit({ ...pair, title: "Chinos", description: "34’’ waist and 30’’ length" }, trousers).status, "match");
  const shoes = validateProfile({ wants: { shoes: 1 }, sizes: "UK 9", budget: 80 });
  assert.equal(assessFit({ kind: "shoes", title: "Loake loafers UK 9", size: "9" }, shoes).status, "match");
  assert.equal(assessFit({ kind: "shoes", title: "Loake loafers UK 8 US 9", size: "9" }, shoes).status, "excluded");
  const jackets = validateProfile({ wants: { jackets: 1 }, budget: 180, clean: false,
    fitByKind: { jackets: { pitToPitCm: [56, 58] } }, styleByKind: { jackets: { require: ["wax"] } } });
  const jacket = { id: "example", kind: "jackets", title: "Waxed Beaufort jacket", currency: "GBP",
    available: true, price: 80, fee: 4.7, description: 'Pit to pit: 23". Sleeves shortened. The hanging hook has broken.' };
  const result = makeResult([jacket], jackets, {}, [], { nearMatches: true });
  assert.equal(result.basket.items.length, 0);
  assert.match(result.nearMatches[0].fit.note, /58\.42 cm/);
  assert.equal(result.nearMatches[0].estimatedDelivered, 89.2);
  assert.deepEqual(result.nearMatches[0].disclosures.map(({ type }) => type), ["alteration", "damage"]);
});

test("41 cm catalogue searches use the Vinted 16.5 inch label for both brands", async () => {
  const profile = validateProfile({ wants: { shirts: 2 }, collar: 41,
    brands: "Ralph Lauren, Hackett", budget: 80 });
  const queries = [];
  const client = { pageGet: async (_country, path) => {
    queries.push(new URL(path, "https://www.vinted.co.uk").searchParams.get("search_text"));
    return { items: [], pagination: {} };
  } };
  await discover(profile, { client, extraSearches: false });
  assert.deepEqual(queries, ["Ralph Lauren shirt 16.5", "Hackett shirt 16.5"]);
});

test("seller wardrobe fills a missing type and one parcel covers both items", async () => {
  const profile = validateProfile({ wants: { shirts: 1, jumpers: 1 }, sizes: "L", budget: 30, delivery: 5 });
  const page = (id, title, sellerId, amount) => ({
    id, title, url: `/items/${id}`, user: { id: sellerId },
    price: { amount, currencyCode: "GBP" }, itemBox: { firstLine: "Hackett", secondLine: "L · Very good" },
  });
  const calls = [];
  const client = {
    pageGet: async (_country, path) => {
      calls.push(path);
      return { items: path.includes("search_text=shirt") ? [page(101, "Oxford shirt", 21, 8)] : [], pagination: {} };
    },
    fetchHtml: async (url) => {
      const shirt = url.endsWith("/101");
      const product = {
        "@type": "Product", name: shirt ? "Oxford shirt" : "Merino jumper", brand: { name: "Hackett" },
        offers: { price: shirt ? 8 : 9, priceCurrency: "GBP", availability: "https://schema.org/InStock" },
      };
      return { body: `<script type="application/ld+json">${JSON.stringify(product)}</script><a href="/member/21">Seller</a>` };
    },
    apiGet: async (_country, path) => {
      if (path.startsWith("/api/v2/wardrobe/21/")) return { items: [{
        id: 102, title: "Merino jumper", price: { amount: 9, currency_code: "GBP" },
        brand_title: "Hackett", size_title: "L", status: "Very good",
      }] };
      return { user: { id: 21, country_code: "UK", login: "example" } };
    },
  };
  let captured;
  const found = await discover(profile, { client, onSnapshot: (data) => { captured = data; } });
  assert.ok(calls.some((path) => path.includes("order=price_asc")));
  assert.ok(calls.some((path) => path.includes("order=newest_first")));
  assert.equal(captured.catalogue.length, 1);
  assert.equal(captured.wardrobe.length, 1);
  const result = makeResult(found.items, profile, found.meta, found.comparables);
  assert.equal(result.meta.wardrobeMatches, 1);
  assert.equal(result.basket.items.length, 2);
  assert.equal(result.basket.cost.parcels, 1);
  assert.equal(result.basket.cost.bundleDeliverySavings, 5);
});

const at = "2020-01-01T11:00:00Z";
const later = "2020-01-01T11:01:00Z";
const feedRow = {
  id: "123", sellerId: "seller-1", kind: "shirts", title: "Oxford shirt", price: 10,
  currency: "GBP", size: "41", condition: "Very good", available: true,
  url: "https://www.vinted.co.uk/items/123-oxford-shirt",
};
const batch = { version: 1, source: "Fixture feed", mode: "snapshot", capturedAt: at, cursor: "next", listings: [feedRow] };
const update = { ...batch, mode: "delta", capturedAt: later, cursor: "following", listings: [{ ...feedRow, price: 7 }] };

test("feed applies idempotent deltas and tracks price changes and removals", () => {
  const initial = applyFeed(null, batch);
  assert.equal(applyFeed(initial, batch), initial);
  const state = applyFeed(initial, update);
  const found = searchFeed(state, { now: Date.parse(later) });
  assert.equal(found.meta.mode, "feed");
  assert.equal(found.items[0].priceDrop.amount, 3);
  assert.throws(() => searchFeed(state, { now: Date.parse(later) + 61 * 60_000 }), /stale/);
  assert.throws(() => applyFeed(state, batch), /timestamp order/);
  const removed = applyFeed(state, { ...update, capturedAt: "2020-01-01T11:02:00Z", listings: [], removedIds: ["123"] });
  assert.equal(searchFeed(removed, { now: Date.parse(later) + 60_000 }).items.length, 0);
  assert.equal(removed.records[0].history.at(-1).available, false);
});

test("configured HTTPS feed passes cursor and atomically keeps the last good state", async (t) => {
  const directory = await mkdtemp(join(process.cwd(), "scout-feed-test-"));
  const file = join(directory, "state.json");
  t.after(async () => {
    await unlink(file).catch((error) => { if (error.code !== "ENOENT") throw error; });
    await rmdir(directory);
  });
  await syncFeed(file, () => batch);
  await assert.rejects(syncFeed(file, () => ({ ...update, source: "wrong source" })), /different source/);
  assert.equal((await readFeed(file)).cursor, "next");
  await syncFeed(file, (cursor) => fetchFeedBatch("https://feed.example/listings", {
    cursor,
    token: "fixture",
    fetcher: async (url, options) => {
      assert.equal(url.searchParams.get("cursor"), "next");
      assert.equal(options.headers.authorization, "Bearer fixture");
      assert.equal(options.redirect, "error");
      return Response.json(update);
    },
  }));
  assert.equal((await readFeed(file)).records[0].listing.price, 7);
  assert.ok(!JSON.stringify(await readFeed(file)).includes("Bearer fixture"));
  const clock = Date.now();
  await syncFeed(file, () => ({ ...update, capturedAt: new Date(clock).toISOString() }));
  const cli = spawnSync(process.execPath, ["scripts/scout.mjs", "search", "--stdin", "--json"], {
    env: { ...process.env, SCOUT_FEED_FILE: file },
    input: JSON.stringify({ profile: { wants: { shirts: 1 }, fitByKind: { shirts: { collarCm: 41 } }, budget: 20 } }),
    encoding: "utf8",
  });
  assert.equal(cli.status, 0, cli.stderr);
  const search = JSON.parse(cli.stdout);
  assert.equal(search.meta.mode, "feed");
  assert.equal(search.basket.items[0].priceDrop.amount, 3);
});

test("benchmark replays the same brief with and without seller additions", () => {
  const processResult = spawnSync(process.execPath, ["scripts/benchmark.mjs", "replay", "examples/benchmark.json"], { encoding: "utf8" });
  assert.equal(processResult.status, 0, processResult.stderr);
  const [result] = JSON.parse(processResult.stdout);
  assert.equal(result.catalogueOnly.filled, 2);
  assert.equal(result.withWardrobes.filled, 2);
  assert.equal(result.withWardrobes.parcels, 1);
  assert.equal(result.savingsAtEqualCoverage, 4);
});
