import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rmdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

async function shopper(t) {
  const directory = await mkdtemp(join(process.cwd(), "scout-shop-test-"));
  const file = join(directory, "taste.json");
  t.after(async () => {
    await unlink(file).catch((error) => { if (error.code !== "ENOENT") throw error; });
    await rmdir(directory);
  });
  return (request) => {
    const result = spawnSync(process.execPath, ["scripts/scout.mjs", "shop", "--stdin", "--json"], {
      input: JSON.stringify(request), encoding: "utf8", timeout: 5000,
      env: { ...process.env, SCOUT_TASTE_FILE: file },
    });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  };
}

const row = (id, title, price, extra = {}) => ({
  id, title, price, kind: "jumpers", size: "L", brand: "Hackett", condition: "Very good",
  sellerId: id, ...extra,
});
const ids = (result) => result.basket.items.map(({ id }) => id);

test("saved and skipped feedback persists across CLI calls and price skips do not teach dislike", async (t) => {
  const shop = await shopper(t);
  const profile = { wants: { jumpers: 1 }, sizes: "L", budget: 35 };
  const training = [
    row("saved", "Navy lambswool V-neck jumper", 15),
    row("colour-skip", "Cream jumper", 13),
    row("price-skip", "Navy lambswool V-neck jumper", 24),
  ];
  shop({ profile, listings: training });
  shop({ action: "save", id: "saved" });
  shop({ action: "save", id: "saved" });
  shop({ action: "skip", id: "colour-skip", reason: "colour", trait: "cream" });
  const { taste } = shop({ action: "skip", id: "price-skip", reason: "price" });
  assert.equal(taste.saves, 1);
  assert.deepEqual(taste.byKind.jumpers.dislikes, [{ field: "colour", value: "cream" }]);
  assert.ok(taste.byKind.jumpers.likes.some(({ value }) => value === "navy"));

  const listings = [row("cream-new", "Cream jumper", 13), row("navy-new", "Navy lambswool V-neck jumper", 15),
    row("too-small", "Navy lambswool V-neck jumper", 4, { size: "S" }),
    row("too-expensive", "Navy lambswool V-neck jumper", 45)];
  const neutral = shop({ profile, listings, personalise: false });
  const learned = shop({ profile, listings });
  assert.deepEqual(ids(neutral), ["cream-new"]);
  assert.deepEqual(ids(learned), ["navy-new"]);
  assert.ok(learned.basket.cost.total <= profile.budget);
  assert.ok(learned.basket.items[0].tasteEvidence.some(({ value, source }) => value === "navy" && source === "saved"));
  assert.deepEqual(ids(shop({ profile, listings: [training[2]] })), []);
  assert.deepEqual(ids(shop({ profile, listings: [{ ...training[2], price: 19 }] })), ["price-skip"]);
  shop({ action: "forget" });
  assert.equal(shop({ action: "taste" }).taste.saves, 0);
});

test("more like this can change colour while retaining exact fit, model, condition and budget", async (t) => {
  const shop = await shopper(t);
  const jacket = (id, title, price, description = "Pit to pit 57 cm. Corduroy collar.") =>
    row(id, title, price, { description, kind: "jackets", brand: "Barbour" });
  const profile = { wants: { jackets: 1 }, fitByKind: { jackets: { pitToPitCm: [56, 58] } },
    styleByKind: { jackets: { require: ["beaufort", "olive", "waxed", "corduroy collar"] } },
    brands: "Barbour", budget: 120 };
  const anchor = jacket("anchor", "Olive Barbour Beaufort waxed jacket", 103);
  const cheaper = jacket("cheaper", "Navy Barbour Beaufort waxed jacket", 88);
  const listings = [anchor, cheaper, jacket("wrong-model", "Navy Barbour Bedale waxed jacket", 28),
    jacket("no-size", "Navy Barbour Beaufort waxed jacket", 50, "Corduroy collar."),
    jacket("repair", "Navy Barbour Beaufort waxed jacket", 60, "Pit to pit 57 cm. Corduroy collar. Zip missing."),
    jacket("over-budget", "Navy Barbour Beaufort waxed jacket", 125),
    jacket("not-waxed", "Navy Barbour Beaufort jacket", 30, "Pit to pit 57 cm. Corduroy collar. Not waxed.")];
  const first = shop({ profile, listings });
  assert.deepEqual(ids(first), ["anchor"]);
  const next = shop({ action: "more", id: "anchor", style: { require: ["navy"] }, listings });
  assert.deepEqual(ids(next), ["anchor"]);
  assert.deepEqual(next.preview.items.map(({ id }) => id), ["cheaper"]);
  assert.deepEqual(next.picks, [{ number: 1, id: "anchor" }, { number: 2, id: "cheaper" }]);
  assert.deepEqual(next.profile.fitByKind.jackets.pitToPitCm, [56, 58]);
  assert.deepEqual(next.profile.styleByKind.jackets.require, ["beaufort", "waxed", "corduroy collar", "navy"]);
  assert.equal(next.profile.budget, profile.budget);
  assert.equal(first.basket.cost.total - next.preview.cost.total, 15.75);
  const near = shop({ action: "more", id: "anchor", style: { require: ["navy"] },
    listings: listings.filter((item) => item.id !== "cheaper") });
  assert.deepEqual(ids(near), ["anchor"]);
  assert.deepEqual(near.preview.items, []);
  assert.ok(near.nearMatches.some(({ id, questions }) =>
    id === "no-size" && questions.some((question) => question.includes("armpit to armpit"))));
  assert.ok(!near.nearMatches.some(({ id }) => ["wrong-model", "repair", "not-waxed"].includes(id)));
});

test("explicit cut feedback carries across listings and garment colours exclude the logo colour", async (t) => {
  const shop = await shopper(t);
  const shirt = (id, title, price) => row(id, title, price, { kind: "shirts", size: "16.5 in | 41 cm" });
  const profile = { wants: { shirts: 1, jumpers: 1 }, budget: 55,
    fitByKind: { shirts: { collarCm: 41 }, jumpers: { sizes: ["M", "L"] } } };
  const slim = shirt("slim", "Hackett slim fit shirt", 5);
  const jumper = row("blue", "Blue V-neck jumper with red pony logo", 14, {
    brand: "Polo Ralph Lauren", description: "Blue knit with the signature red embroidered Polo pony logo on the chest.",
  });
  shop({ profile, listings: [slim, jumper] });
  shop({ action: "skip", id: "slim", reason: "fit", trait: "slim fit" });
  const { taste } = shop({ action: "save", id: "blue" });
  const likes = taste.byKind.jumpers.likes.map(({ value }) => value);
  assert.ok(likes.includes("blue") && likes.includes("embroidered logo"));
  assert.ok(!likes.includes("red"));
  const listings = [jumper, shirt("new-slim", "Hackett slim fit shirt", 4),
    shirt("unknown", "Hackett Oxford shirt", 18)];
  const learned = shop({ profile, listings });
  assert.deepEqual(ids(learned).sort(), ["blue", "unknown"]);
  assert.ok(learned.basket.items.find(({ id }) => id === "unknown").reasons.some((reason) => reason.includes("Cut is unspecified")));
  const explicit = shop({ profile: { ...profile, styleByKind: { shirts: { require: ["slim fit"] } } }, listings });
  assert.deepEqual(ids(explicit).sort(), ["blue", "new-slim"]);
});

test("one agent feedback call saves choices and automatically replaces the skipped basket item", async (t) => {
  const shop = await shopper(t);
  const shirt = (id, title, price) => row(id, title, price, { kind: "shirts", size: "16.5 in | 41 cm", fee: 1 });
  const profile = { wants: { shirts: 2, jumpers: 1 }, budget: 85,
    fitByKind: { shirts: { collarCm: 41 }, jumpers: { sizes: ["M", "L"] } } };
  const first = shop({ profile, listings: [
    shirt("pink", "Pink cotton shirt", 8), shirt("slim", "Hackett slim-fit shirt", 12),
    row("blue", "Blue V-neck jumper", 10), row("navy", "Navy V-neck jumper", 24),
  ] });
  const number = (id) => first.picks.find((pick) => pick.id === id).number;
  const saveOnly = shop({ action: "feedback", changes: [{ action: "save", number: number("pink") }] });
  assert.deepEqual(saveOnly.picks, first.picks);
  const after = shop({ action: "feedback", changes: [
    { action: "save", number: number("pink") }, { action: "save", number: number("blue") },
    { action: "skip", number: number("slim"), reason: "fit", trait: "slim fit" },
    { action: "skip", number: number("navy"), reason: "price" },
  ], replacementListings: [shirt("classic", "Hackett classic-fit shirt", 5)] });
  assert.equal(after.applied.length, 4);
  assert.equal(after.followUp.meta.mode, "replay");
  assert.equal(after.followUp.replacement.item.id, "classic");
  assert.deepEqual(ids(after).sort(), ["blue", "classic", "pink"]);
  assert.equal(after.followUp.leaveOpen.cost.total, 29.2);
  assert.equal(after.basket.cost.total, 39.7);
  assert.equal(after.taste.saves, 2);
  assert.equal(after.taste.skips, 2);
});

test("a fourth shirt requires a retained seller and keeps pick numbers stable", async (t) => {
  const shop = await shopper(t);
  const shirt = (id, title, price, sellerId) => row(id, title, price,
    { kind: "shirts", size: "16.5 in | 41 cm", fee: 1, sellerId });
  const profile = { wants: { shirts: 4, jumpers: 1 }, budget: 100,
    fitByKind: { shirts: { collarCm: 41 }, jumpers: { sizes: ["M", "L"] } } };
  const blue = row("blue", "Blue V-neck jumper", 10);
  const first = shop({ profile, listings: [blue,
    shirt("one", "White Oxford shirt", 8, "retained"),
    shirt("two", "Green Oxford shirt", 9, "two"),
    shirt("three", "Striped Oxford shirt", 11, "three"),
    shirt("slim", "Hackett slim-fit shirt", 5, "discarded"),
  ] });
  const number = (id) => first.picks.find((pick) => pick.id === id).number;
  const after = shop({ action: "feedback", bundleAt: { shirts: 4 }, changes: [
    { action: "save", number: number("blue") },
    { action: "skip", number: number("slim"), reason: "fit", trait: "slim fit" },
  ], replacementListings: [
    shirt("elsewhere", "Hackett regular fit shirt", 2, "different"),
    shirt("bundle", "Hackett classic fit shirt", 12, "retained"),
    shirt("wrong-seller", "Hackett classic fit shirt", 1, "discarded"),
  ] });
  assert.equal(after.followUp.bundleOnly, true);
  assert.equal(after.followUp.replacement.item.id, "bundle");
  assert.equal(after.followUp.replacement.sameSeller, true);
  assert.equal(after.basket.cost.parcels, after.followUp.leaveOpen.cost.parcels);
  assert.equal(after.basket.cost.total - after.followUp.leaveOpen.cost.total, 13);
  assert.deepEqual(after.picks.find(({ id }) => id === "blue"), { number: number("blue"), id: "blue" });
  assert.deepEqual(after.picks.find(({ id }) => id === "bundle"), { number: 6, id: "bundle" });
  const open = shop({ action: "feedback", changes: [
    { action: "skip", number: 6, reason: "fit" },
  ], replacementListings: [shirt("elsewhere", "Hackett regular fit shirt", 2, "different")] });
  assert.deepEqual(open.basket.missing, [{ kind: "shirts", qty: 1 }]);
  assert.equal(open.basket.cost.total, after.followUp.leaveOpen.cost.total);
  assert.equal(open.followUp.replacement, null);
});
