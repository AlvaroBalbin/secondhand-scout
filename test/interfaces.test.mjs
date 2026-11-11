import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const script = (name) => fileURLToPath(new URL(`../scripts/${name}.mjs`, import.meta.url));

test("guided CLI retries invalid input and builds a basket without a file", () => {
  const result = spawnSync(process.execPath, [script("scout"), "--demo", "--json"], {
    input: "hats\n2 shirts and 1 sweater\n41 cm\nL\n1,50\n£150\nmen\nRalph Lauren, Hackett\n",
    encoding: "utf8",
    timeout: 5000,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /Use shirts/);
  assert.match(result.stderr, /Enter a budget/);
  const { profile, basket, meta } = JSON.parse(result.stdout);
  assert.equal(meta.mode, "demo");
  assert.equal(profile.collar, 41);
  assert.equal(profile.budget, 150);
  assert.deepEqual(profile.sizes, ["L"]);
  assert.deepEqual(profile.brands, ["Ralph Lauren", "Hackett"]);
  assert.equal(basket.items.length, 3);
  assert.ok(basket.cost.total <= profile.budget);
  assert.equal(basket.cost.parcels, 1);
});

test("guided CLI cancels when the answers end early", () => {
  const result = spawnSync(process.execPath, [script("scout")], {
    input: "2 jumpers\n",
    encoding: "utf8",
    timeout: 5000,
  });
  assert.equal(result.status, 1, result.stderr);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /Shopping brief cancelled/);
});

test("an agent can rank a brief and supplied listings using stdin only", () => {
  const result = spawnSync(process.execPath, [script("scout"), "rank", "--stdin", "--json"], {
    input: JSON.stringify({
      profile: { wants: { jumpers: 1 }, sizes: "L", budget: 30 },
      listings: [
        { kind: "jumpers", title: "Merino jumper", size: "L", price: 10 },
        { kind: "jumpers", title: "Cotton jumper", size: "S", price: 3 },
      ],
    }),
    encoding: "utf8",
    timeout: 5000,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  const { basket, meta } = JSON.parse(result.stdout);
  assert.equal(meta.mode, "manual");
  assert.deepEqual(basket.items.map(({ title }) => title), ["Merino jumper"]);
  assert.ok(basket.cost.total <= 30);
});

test("MCP client discovers tools and ranks real-shaped input without marketplace access", async (t) => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [script("mcp")],
  });
  const client = new Client({ name: "scout-test", version: "1.0.0" });
  t.after(() => client.close());
  await client.connect(transport);
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map(({ name }) => name).sort(),
    ["check_listings", "demo_deals", "rank_listings", "search_deals"]);
  assert.ok(tools.every(({ annotations }) => annotations.readOnlyHint));
  const profile = { wants: { shirts: 2 }, collar: 41, budget: 45 };
  const demo = await client.callTool({ name: "demo_deals", arguments: { profile } });
  assert.equal(demo.structuredContent.meta.mode, "demo");
  assert.equal(demo.structuredContent.basket.items.length, 2);
  assert.deepEqual(demo.structuredContent.profile.sizes, []);
  assert.deepEqual(JSON.parse(demo.content[0].text), demo.structuredContent);

  const listings = [
    { kind: "shirts", title: "White Oxford shirt", price: 8, size: "41", sellerId: "seller" },
    { kind: "shirts", title: "Blue Oxford shirt", price: 11, size: "41", sellerId: "seller" },
    { kind: "shirts", title: "Striped Oxford shirt", price: 2, size: "39", sellerId: "other" },
  ];
  const ranked = await client.callTool({ name: "rank_listings", arguments: { profile, listings } });
  assert.equal(ranked.structuredContent.meta.mode, "manual");
  assert.equal(ranked.structuredContent.basket.items.length, 2);
  assert.equal(ranked.structuredContent.basket.cost.parcels, 1);
  assert.ok(ranked.structuredContent.basket.cost.total <= profile.budget);

  const invalid = await client.callTool({
    name: "search_deals",
    arguments: { profile: { wants: { jumpers: 1 }, budget: 40 } },
  });
  assert.equal(invalid.isError, true);
  assert.match(invalid.content[0].text, /clothing sizes/);
});
