import test from "node:test";
import assert from "node:assert/strict";
import { replaceSkipped } from "../scripts/replacement.mjs";
import { makeResult, validateProfile } from "../src/engine.js";
import { startShopping, prepareFollowUp } from "../src/hosted-shopping.js";
import { discoverReplacements } from "../src/provider.js";
import { feedbackFor, listingMemory } from "../src/taste.js";

const shirt = (id, title, price, sellerId = "9", size = "16.5 in | 41 cm") => ({
  id, kind: "shirts", title, price, sellerId, size, fee: 1, currency: "GBP", brand: "Hackett",
});
const profile = { wants: { shirts: 2 }, collar: 41, budget: 70, delivery: 4.5, brands: "Hackett" };
const keep = shirt("keep", "Pink Hackett shirt", 11, "12");
const current = shirt("current", "Hackett shirt", 30);
const skipped = shirt("skip", "Hackett slim-fit shirt", 10);
const feedback = [
  feedbackFor(listingMemory(keep), "save"),
  feedbackFor(listingMemory(skipped), "skip", "fit", "slim fit"),
];

test("hosted swap retains pick numbers and only accepts a cheaper bundle", async () => {
  const brief = { ...profile, wants: { shirts: 3 } };
  const initial = startShopping(brief, makeResult([
    shirt("one", "Hackett shirt", 5, "11"),
    shirt("two", "Hackett shirt", 10, "12"),
    shirt("three", "Hackett shirt", 15, "13"),
  ], validateProfile(brief)));
  assert.deepEqual(initial.picks.map(({ number, id }) => [number, id]), [[1, "one"], [2, "two"], [3, "three"]]);
  const action = prepareFollowUp({ session: initial.session, keep: [2], swap: { number: 3, bundleOnly: true } });
  const miss = await action.run({ discover: async (_brief, request) => {
    assert.equal(request.bundleOnly, true);
    assert.deepEqual(request.sellerIds, ["11", "12"]);
    return { items: [shirt("separate", "Hackett shirt", 1, "99"),
      shirt("higher", "Hackett shirt", 16, "12")], meta: {} };
  } });
  assert.equal(miss.outcome, "no_replacement");
  assert.equal(miss.basket.cost.total, initial.basket.cost.total);
  assert.equal(miss.leaveOpenTotal, 26);
  assert.throws(() => prepareFollowUp({ session: miss.session, swap: { number: 2 } }), /not kept/);
  const hit = await action.run({ discover: async () => ({ items: [
    { ...shirt("bundled", "Hackett shirt", 7, "12"), description: "Sleeves shortened." },
  ], meta: {} }) });
  assert.equal(hit.outcome, "replaced");
  assert.equal(hit.basket.cost.total, 34);
  assert.equal(hit.basket.cost.parcels, 2);
  assert.deepEqual(hit.picks.map(({ number, id, saved }) => [number, id, saved]),
    [[1, "one", false], [2, "two", true], [3, "bundled", false]]);
  assert.equal(hit.picks[2].disclosures[0].type, "alteration");
});

test("cheapest confirmed replacement uses the whole-basket delivered cost and retains saved picks", async () => {
  const result = await replaceSkipped({ profile, basket: [keep, current] }, feedback, skipped.id, {
    discover: async (brief, request) => {
      assert.deepEqual(brief.wants, [{ kind: "shirts", qty: 1 }]);
      assert.equal(brief.fitByKind.shirts.collarCm, 41);
      assert.deepEqual(request.sellerIds, ["12"]);
      assert.ok(request.exclude.has("skip") && request.exclude.has("keep"));
      return { items: [
        shirt("same", "Hackett classic fit shirt", 11, "12"),
        shirt("separate", "Hackett regular fit shirt", 8, "8"),
        shirt("unknown", "Hackett shirt", 3),
        shirt("slim", "Hackett slim fit shirt", 2),
        shirt("wrong", "Hackett classic fit shirt", 2, "12", "16 in | 40 cm"),
        { ...shirt("damage", "Hackett classic fit shirt", 2, "12"), description: "Stain on the sleeve." },
        shirt("expensive", "Hackett classic fit shirt", 40, "12"),
      ], meta: {} };
    },
  });
  assert.equal(result.leaveOpen.cost.total, 16.5);
  assert.equal(result.previous.cost.total, 52);
  assert.equal(result.basket.cost.total, 28.5);
  assert.equal(result.basket.cost.parcels, 1);
  assert.deepEqual(result.options.map(({ item }) => item.id), ["same", "separate"]);
  assert.deepEqual(result.basket.items.map(({ id }) => id), ["keep", "same"]);
});

test("keeps the slot open when no cheaper confirmed shirt was found", async () => {
  const result = await replaceSkipped({ profile, basket: [keep, skipped] }, feedback, skipped.id, {
    discover: async () => ({ items: [shirt("pricey", "Hackett regular fit shirt", 25)], meta: {} }),
  });
  assert.equal(result.basket, null);
  assert.equal(result.leaveOpen.cost.total, 16.5);
});

test("repeating a replacement searches the same slot even when another shirt costs more", async () => {
  const other = shirt("other", "Hackett regular fit shirt", 27);
  const prior = shirt("prior", "Hackett classic fit shirt", 9);
  const result = await replaceSkipped({ profile, basket: [other, prior], replacementSlots: { skip: "prior" } },
    [feedback[1]], skipped.id, {
      discover: async () => ({ items: [shirt("cheaper", "Hackett regular fit shirt", 5)], meta: {} }),
    });
  assert.equal(result.previous.item.id, "prior");
  assert.deepEqual(result.basket.items.map(({ id }) => id), ["other", "cheaper"]);
});

test("basket seller wardrobes are requested before wider catalogue and it searches only the skipped garment", async () => {
  const events = [];
  const client = {
    apiGet: async (_country, path) => { events.push(path); return { items: [] }; },
    pageGet: async (_country, path) => {
      events.push(new URL(path, "https://www.vinted.co.uk").searchParams.get("search_text"));
      return { items: [], pagination: {} };
    },
  };
  const parsed = validateProfile({ ...profile, styleByKind: { shirts: { search: "classic fit" } } });
  const result = await discoverReplacements(parsed, {
    kind: "shirts", sellerIds: ["12", "12", "45"], exclude: new Set(), maxPrice: 25, matches: () => true, client,
  });
  assert.match(events[0], /12/);
  assert.match(events[1], /45/);
  assert.deepEqual(events.slice(2), ["Hackett shirt 16.5 classic fit", "Hackett shirt 16.5"]);
  assert.equal(result.meta.wardrobesChecked, 2);
  events.length = 0;
  const bundled = await discoverReplacements(parsed, {
    kind: "shirts", sellerIds: ["12", "45"], exclude: new Set(), maxPrice: 25, matches: () => true, client,
    bundleOnly: true,
  });
  assert.equal(events.length, 2);
  assert.equal(bundled.meta.catalogueQueries, 0);
});
