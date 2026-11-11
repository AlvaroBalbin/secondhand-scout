import test from "node:test";
import assert from "node:assert/strict";
import { api } from "../src/app.js";
import {
  assessFit,
  disclosedDefects,
  makeResult,
  validateProfile,
} from "../src/engine.js";
import {
  PublicVintedTransport,
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
  size: "16 in | 40 cm",
  currency: "GBP",
  price: 10,
  fee: 1,
};

test("collar inch label takes precedence over a misleading marketplace conversion", () => {
  assert.equal(assessFit(shirt, profile).status, "match");
  assert.equal(
    assessFit({ ...shirt, size: "16.5 in | 41 cm" }, profile).status,
    "excluded",
  );
  assert.equal(
    assessFit({ ...shirt, title: "Oxford shirt 16½", size: "41" }, profile)
      .status,
    "excluded",
  );
  assert.equal(
    assessFit({ ...shirt, description: "Chest 56 cm." }, profile).status,
    "match",
  );
  assert.equal(assessFit({ ...shirt, size: "L" }, profile).status, "unknown");
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
  assert.equal(result.basket.missing.length, 0);
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
