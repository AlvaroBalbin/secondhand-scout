import test from "node:test";
import assert from "node:assert/strict";
import { api } from "../src/app.js";
import {
  assessFit,
  disclosedDefects,
  hasLogoEvidence,
  kindMatches,
  listingStyleEvidence,
  makeResult,
  validateProfile,
} from "../src/engine.js";
import {
  PublicVintedTransport,
  discover,
  parseListingUrl,
  readListing,
} from "../src/provider.js";

const profile = validateProfile({
  wants: { shirts: 2, jumpers: 1 },
  brands: "Ralph Lauren",
  sizes: "L",
  collar: 41,
  budget: 45,
  delivery: 5,
});
const shirt = {
  kind: "shirts",
  title: "Blue Oxford shirt",
  brand: "Ralph Lauren",
  size: "16.5 in | 41 cm",
  currency: "GBP",
  price: 10,
  fee: 1,
};

test("Vinted collar labels match their catalogue size and explicit conflicting measurements take precedence", () => {
  assert.equal(assessFit(shirt, profile).status, "match");
  assert.equal(
    assessFit({ ...shirt, size: "16 in | 40 cm" }, profile).status,
    "excluded",
  );
  assert.equal(assessFit({ ...shirt, title: "Oxford shirt 16½" }, profile).status, "match");
  assert.equal(assessFit({ ...shirt, description: "Collar 42 cm." }, profile).status, "excluded");
  assert.equal(assessFit({ ...shirt, size: "L", title: "Oxford shirt, chest 41 cm" }, profile).status, "unknown");
  assert.equal(
    assessFit({ ...shirt, title: "Oxford shirt 16½", size: "41" }, profile)
      .status,
    "match",
  );
  assert.equal(
    assessFit({ ...shirt, description: "Chest 56 cm." }, profile).status,
    "match",
  );
  assert.equal(assessFit({ ...shirt, size: "L" }, profile).status, "unknown");
});

test("listing categories and logo evidence distinguish actual garment details", () => {
  for (const title of ["Hackett shirt", "Hackett slim fit shirt", "Oxford button-down"]) {
    assert.equal(kindMatches({ title }, "shirts"), true, title);
  }
  for (const title of ["Hackett T-shirt", "Polo shirt", "Oxford short sleeve shirt"]) {
    assert.equal(kindMatches({ title }, "shirts"), false, title);
  }
  assert.equal(kindMatches({ title: "Ralph Lauren V-Neck" }, "jumpers"), true);
  assert.equal(hasLogoEvidence({ description: "No embroidered pony logo." }), false);
  assert.equal(hasLogoEvidence({ description: "Embroidered logo on the inside label." }), false);
  assert.equal(hasLogoEvidence({ description: "Navy embroidered polo pony logo on the chest." }), true);
});

test("children’s label is excluded even when the listing says L", () => {
  const jumper = {
    kind: "jumpers",
    title: "Blue jumper",
    size: "L",
    description: "Label L (14-16)",
  };
  assert.equal(assessFit(jumper, profile).status, "excluded");
});

test("a disclosed stain is caught even after an unrelated negation", () => {
  assert.equal(disclosedDefects("No holes, stains or damage."), false);
  assert.equal(disclosedDefects("No holes. Tiny stain on the sleeve."), true);
});

test("disclosed marks, wear and missing fasteners are detected with scoped negation", () => {
  for (const text of [
    "Great condition except for one small mark on the front.",
    "Second-last button missing, easily fixable.",
    "Some internal bobbling and the collar is a little faded.",
    "No holes, but the zipper pull came off.",
    "A few pulled/loose threads in places.",
  ]) assert.equal(disclosedDefects(text), true, text);
  for (const text of [
    "No signs of any damage or wear.",
    "No obvious major stains, holes or damage visible in the supplied photographs.",
    "Free of grubby marks, yellowing or staining.",
    "No missing buttons. Marks & Spencer shirt in a faded denim wash.",
    "Fully working zip, lost weight and it is too large for me.",
    "Light general wear consistent with a pre-owned item.",
    "Excellent condition. Just needs an iron.",
  ]) assert.equal(disclosedDefects(text), false, text);
});

test("size evidence distinguishes missing labels, seller sizing and tag conflicts", () => {
  const shopper = validateProfile({ wants: { jumpers: 1 }, sizes: "L", budget: 50 });
  const item = { kind: "jumpers", title: "Merino jumper", size: "L" };
  assert.equal(assessFit({ ...item, description: "I can’t see a size label, but I would say L." }, shopper).status, "unknown");
  assert.equal(assessFit({ ...item, description: "Marked size XXL but fits a size large." }, shopper).status, "excluded");
  assert.equal(assessFit({ ...item, description: "Size medium." }, shopper).status, "unknown");
  assert.equal(assessFit({ ...item, size: "", description: "Size: Men’s Large." }, shopper).status, "match");
  assert.equal(assessFit({ ...item, size: "", title: "Merino jumper, L", description: "Soft wool.\nLarge\nGood condition." }, shopper).status, "match");
  assert.equal(assessFit({ ...item, size: "", title: "Merino jumper large men’s" }, shopper).status, "match");
  assert.equal(assessFit({ ...item, size: "", title: "Merino jumper with large pockets" }, shopper).status, "unknown");
});

test("a comparison to another garment does not count as style evidence", () => {
  const item = { title: "Formal shirt", description: "Smooth cotton (not the rough stuff you get on a lot of Oxford shirts)." };
  assert.deepEqual(listingStyleEvidence(item, ["oxford"]), []);
  assert.equal(listingStyleEvidence({ ...item, title: "Oxford shirt" }, ["oxford"])[0].field, "title");
});

test("one delivery allowance per seller keeps the basket within budget", () => {
  const items = [
    { ...shirt, id: "a", sellerId: "one" },
    { ...shirt, id: "b", sellerId: "one" },
    {
      ...shirt,
      id: "c",
      sellerId: "two",
      title: "Grey wool jumper",
      kind: "jumpers",
      size: "L",
    },
  ];
  const result = makeResult(items, profile);
  assert.equal(result.basket.items.length, 3);
  assert.equal(result.basket.cost.parcels, 2);
  assert.equal(result.basket.cost.total, 43);
  assert.equal(result.basket.cost.bundleDeliverySavings, 5);
  assert.equal(result.basket.missing.length, 0);
});

test("the benchmark uses other comparable sellers and includes fees", () => {
  const shopper = validateProfile({ wants: { shirts: 1 }, sizes: "L", collar: 41, budget: 50 });
  const listing = {
    ...shirt, id: "deal", sellerId: "target", price: 8, fee: 2, condition: "Very good",
  };
  const peer = (sellerId, price) => ({ ...listing, id: sellerId, sellerId, price, fee: 1 });
  const others = [
    peer("one", 17), peer("two", 19), peer("three", 21), peer("four", 40),
    { ...peer("four", 45), id: "duplicate-seller-listing" },
    { ...peer("target", 99), id: "own-seller-listing" },
    { ...peer("cashmere", 100), title: "Cashmere shirt" },
    { ...peer("good", 5), condition: "Good" },
    { ...peer("unavailable", 80), available: false },
    { ...peer("wrong-size", 100), size: "43" },
    { ...peer("defect", 1), description: "Rip on the sleeve." },
  ];
  const result = makeResult([listing], shopper, { mode: "live" }, [listing, ...others]);
  const { deal } = result.basket.items[0];
  assert.deepEqual(deal, {
    source: "observed_catalogue",
    comparableSellers: 4,
    medianItemPrice: 20,
    medianWithFees: 21,
    itemWithFees: 10,
    belowMedian: 11,
    feesEstimated: false,
  });
  const thin = makeResult([listing], shopper, { mode: "live" }, [listing, ...others.slice(0, 3)]);
  assert.equal(thin.basket.items[0].deal, null);
});

test("an affordable bundle can use candidates outside the displayed shortlist", () => {
  const shopper = validateProfile({ wants: { shirts: 1, jackets: 1 }, sizes: "L", budget: 23, delivery: 3 });
  const distractors = Array.from({ length: 50 }, (_, index) => ({
    ...shirt, id: `cheap-${index}`, sellerId: `seller-${index}`, size: "L", price: 4, fee: 0,
  }));
  const bundle = [
    { ...shirt, id: "bundle-shirt", sellerId: "bundle", size: "L", price: 5, fee: 0 },
    { ...shirt, id: "bundle-jacket", sellerId: "bundle", kind: "jackets", title: "Waxed jacket", size: "L", price: 15, fee: 0 },
  ];
  const result = makeResult([...distractors, ...bundle], shopper);
  assert.ok(result.items.every((item) => item.kind === "shirts"));
  assert.deepEqual(result.basket.items.map(({ id }) => id), ["bundle-shirt", "bundle-jacket"]);
  assert.equal(result.basket.cost.total, 23);
  assert.deepEqual(result.basket.missing, []);
});

test("knitwear search excludes a sweatshirt even if the title says sweater", () => {
  const shopper = validateProfile({ wants: { jumpers: 1 }, sizes: "L", budget: 50 });
  const jumper = { ...shirt, kind: "jumpers", size: "L" };
  const result = makeResult([
    { ...jumper, id: "sweatshirt", title: "Hackett sweater dark green", description: "Large Hackett green sweatshirt", price: 5 },
    { ...jumper, id: "knitwear", title: "Hackett cotton jumper", description: "No rips or tears", price: 14 },
  ], shopper);
  assert.deepEqual(result.basket.items.map(({ id }) => id), ["knitwear"]);
});

test("the same listing link and a known size mismatch cannot fill the basket", () => {
  const shopper = validateProfile({ wants: { jumpers: 3 }, sizes: "L", budget: 50, strictFit: false });
  const jumper = { ...shirt, kind: "jumpers", title: "Merino jumper", size: "L" };
  const result = makeResult([
    { ...jumper, id: "first", url: "https://www.vinted.co.uk/items/123-merino-jumper" },
    { ...jumper, id: "duplicate", url: "https://www.vinted.co.uk/items/123" },
    { ...jumper, id: "wrong-size", size: "M" },
  ], shopper);
  assert.equal(result.basket.items.length, 1);
  assert.deepEqual(result.basket.missing, [{ kind: "jumpers", qty: 2 }]);
});

test("listing input and same-item redirects stay on Vinted UK", async () => {
  assert.throws(() =>
    parseListingUrl("https://www.vinted.co.uk.example.org/items/123"),
  );
  assert.equal(
    parseListingUrl("https://www.vinted.co.uk/items/123-shirt?ref=abc").url,
    "https://www.vinted.co.uk/items/123-shirt",
  );
  const urls = [];
  const client = new PublicVintedTransport({
    delay: 0,
    fetcher: async (url) => {
      urls.push(url);
      if (urls.length === 1)
        return Response.redirect(
          "https://www.vinted.co.uk/items/123-shirt",
          307,
        );
      return new Response("public listing");
    },
  });
  assert.equal(
    (await client.fetchHtml("https://www.vinted.co.uk/items/123")).body,
    "public listing",
  );
  assert.equal(urls.length, 2);
});

test("a marketplace denial stops the transport", async () => {
  let calls = 0;
  const client = new PublicVintedTransport({
    delay: 0,
    fetcher: async () => {
      calls += 1;
      return new Response(null, { status: 403 });
    },
  });
  await assert.rejects(
    client.fetchHtml("https://www.vinted.co.uk/items/123"),
    /403/,
  );
  await assert.rejects(
    client.fetchHtml("https://www.vinted.co.uk/items/123"),
    /blocked/,
  );
  assert.equal(calls, 1);
});

test("listing detail reads the size value and separates the displayed fee", async () => {
  const product = {
    "@type": "Product",
    name: "Blue shirt",
    brand: { name: "Ralph Lauren" },
    offers: {
      price: 10,
      priceCurrency: "GBP",
      availability: "https://schema.org/InStock",
    },
  };
  const html = `<script type="application/ld+json">${JSON.stringify(product)}</script>
    <div data-testid="item-attributes-size"><div><span>Size</span></div>
    <div itemProp="size"><span>16 in | 40 cm<button>Info</button></span></div></div>
    <button aria-label="£11.20 includes Vinted fee">Price</button>`;
  const item = await readListing(
    { fetchHtml: async () => ({ body: html }) },
    "https://www.vinted.co.uk/items/123",
    "shirts",
  );
  assert.equal(item.size, "16 in | 40 cm");
  assert.equal(item.fee, 1.2);
  assert.equal(item.available, true);
});

test("discovery replaces bad detail matches and checks sellers only for qualified items", async () => {
  const shopper = validateProfile({ wants: { shirts: 1, jumpers: 1 }, sizes: "L", budget: 50 });
  const catalog = (id, title, price) => ({
    id, title, url: `/items/${id}`, user: { id },
    price: { amount: price, currencyCode: "GBP" },
    itemBox: { firstLine: "Hackett", secondLine: "L · Very good" },
  });
  const jumpers = Array.from({ length: 9 }, (_, i) => catalog(i + 101, "Merino jumper", i + 3));
  const rows = [catalog(200, "Oxford shirt", 10), ...jumpers];
  const sellerChecks = [];
  const client = {
    pageGet: async (_country, path) => ({
      items: path.includes("search_text=shirt") ? rows.slice(0, 1) : jumpers,
      pagination: { totalEntries: rows.length },
    }),
    fetchHtml: async (url) => {
      const id = Number(url.split("/").pop());
      const row = rows.find((item) => item.id === id);
      const product = {
        "@type": "Product", name: row.title, brand: { name: "Hackett" },
        description: id < 109 ? "Stain on the sleeve." : "No stains.",
        offers: {
          price: row.price.amount, priceCurrency: "GBP",
          availability: "https://schema.org/InStock", itemCondition: "https://schema.org/UsedCondition",
        },
      };
      return { body: `<script type="application/ld+json">${JSON.stringify(product)}</script><a href="/member/${id}">Seller</a>` };
    },
    apiGet: async (_country, path) => {
      const id = Number(path.split("/").pop());
      sellerChecks.push(id);
      return { user: { id, country_code: "UK", login: `seller-${id}` } };
    },
  };
  const found = await discover(shopper, { client, expandWardrobes: false, extraSearches: false });
  assert.deepEqual(sellerChecks, [200, 109]);
  assert.deepEqual(found.items.map(({ id, condition }) => [id, condition]), [["200", "Very good"], ["109", "Very good"]]);
  assert.deepEqual(found.meta.coverage[1], {
    kind: "jumpers", detailAttempts: 9, eligibleAfterDetail: 1, eligibleAfterSellerCheck: 1,
  });
  assert.equal(makeResult(found.items, shopper, found.meta, found.comparables).basket.items.length, 2);
});

test("API ranks supplied listings and returns a client error for invalid input", async () => {
  const makeRequest = (data) =>
    new Request("http://localhost/api/rank", {
      method: "POST",
      body: JSON.stringify(data),
    });
  const input = { wants: { shirts: 1 }, sizes: "L", collar: 41, budget: 30 };
  const response = await api(
    makeRequest({ profile: input, listings: [shirt] }),
  );
  assert.equal(response.status, 200);
  assert.equal((await response.json()).basket.items.length, 1);
  assert.equal(
    (await api(makeRequest({ profile: input, listings: [null] }))).status,
    400,
  );
});
