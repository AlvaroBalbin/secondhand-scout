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
  assert.deepEqual(ids(next), ["cheaper"]);
  assert.deepEqual(next.profile.fitByKind.jackets.pitToPitCm, [56, 58]);
  assert.deepEqual(next.profile.styleByKind.jackets.require, ["beaufort", "waxed", "corduroy collar", "navy"]);
  assert.equal(next.profile.budget, profile.budget);
  assert.equal(first.basket.cost.total - next.basket.cost.total, 15.75);
  const near = shop({ action: "more", id: "anchor", style: { require: ["navy"] },
    listings: listings.filter((item) => item.id !== "cheaper") });
  assert.deepEqual(ids(near), []);
  assert.ok(near.nearMatches.some(({ id, questions }) =>
    id === "no-size" && questions.some((question) => question.includes("armpit to armpit"))));
  assert.ok(!near.nearMatches.some(({ id }) => ["wrong-model", "repair", "not-waxed"].includes(id)));
});
