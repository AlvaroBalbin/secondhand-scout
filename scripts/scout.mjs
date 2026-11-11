#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { text } from "node:stream/consumers";
import { guidedProfile } from "./guided.mjs";
import { runScout } from "./request.mjs";
import { shop, shopPrompt } from "./shop.mjs";

const args = process.argv.slice(2);
const json = args.includes("--json");
const demo = args.includes("--demo");
const stdin = args.includes("--stdin");
const [command = "wizard", profilePath, ...rest] = args.filter(
  (arg) => !["--json", "--demo", "--stdin"].includes(arg),
);
const example = new URL("../examples/profile.json", import.meta.url);
const money = (amount) => `£${amount.toFixed(2)}`;

async function readRequest() {
  try {
    return JSON.parse(await text(process.stdin));
  } catch {
    throw new Error("Send a JSON request on stdin, for example {\"profile\": {...}}.");
  }
}

function help() {
  console.log(`Secondhand Scout

npm run scout                                         Answer questions and search
secondhand-scout shop                                  Search, save, skip and find similar items
secondhand-scout shop --stdin --json                   Agent shopping and feedback
npm run scout -- wizard --demo                         Answer questions and try sample listings
npm run scout -- demo [profile.json]                   Try sample listings with a ready-made brief
npm run scout -- search profile.json                   Search Vinted UK
npm run scout -- import profile.json URL [URL ...]     Check shared listings
npm run scout -- rank profile.json listings.json       Rank supplied listings
node scripts/scout.mjs search --stdin --json            Read a JSON request from stdin

Add --json for machine-readable results. Use a profile file for saved briefs.`);
}

function report(result, interactive = false) {
  const { meta, profile } = result;
  const basket = result.preview ?? result.basket;
  if (result.preview)
    console.log(`Similar listings. Your basket stays at ${money(result.basket.cost.total)} estimated delivered.`);
  if (result.leaveOpen) {
    console.log(`Leave the slot open: ${money(result.leaveOpen.cost.total)} estimated delivered.`);
    if (!basket) {
      console.log(result.bundleOnly ? "No verified replacement from a seller already in your basket." :
        "No cheaper replacement matched the brief.");
      for (const warning of meta.warnings ?? []) console.log(warning);
      return;
    }
    const difference = money(basket.cost.total - result.leaveOpen.cost.total);
    console.log(`Fill it for ${difference} more with ${result.replacement.item.title}.`);
    if (result.replacement.sameSeller) console.log("The replacement shares the delivery allowance with another pick.");
  }
  console.log(
    meta.mode === "demo"
      ? "Sample shortlist (example listings)"
      : "Secondhand Scout shortlist",
  );
  console.log(
    `${basket.items.length} picks · ${money(basket.cost.total)} estimated total · ${money(profile.budget)} budget`,
  );
  console.log(
    `Items ${money(basket.cost.itemTotal)}, ${basket.cost.feesEstimated ? "estimated fees" : "listed fees"} ${money(basket.cost.fees)}, delivery allowance ${money(basket.cost.delivery)} across ${basket.cost.parcels} seller groups`,
  );
  if (basket.cost.bundleDeliverySavings > 0)
    console.log(`Estimated postage saved by buying together ${money(basket.cost.bundleDeliverySavings)}`);
  for (const group of basket.cost.groups) {
    console.log(
      `\n${group.seller}${group.count > 1 ? ` (${group.count} listings to consider bundling)` : ""}`,
    );
    for (const id of group.ids) {
      const item = basket.items.find((entry) => entry.id === id);
      const pick = result.picks?.find((entry) => entry.id === id);
      const index = interactive && pick ? `${pick.number}. ` : "";
      console.log(
        `  ${index}${money(item.price)}  ${item.brand} ${item.title} (${item.size || "size unspecified"})`,
      );
      console.log(`    ${item.fit.note}`);
      if (item.styleEvidence?.length)
        console.log(`    Listing mentions ${item.styleEvidence.map((evidence) => evidence.excerpt).join(", ")}.`);
      const taste = item.tasteEvidence?.filter((evidence) => evidence.source !== "skipped");
      if (taste?.length)
        console.log(`    Matches saved or reference styles ${[...new Set(taste.map(({ value }) => value))].join(", ")}.`);
      if (item.deal?.belowMedian > 0) {
        const { belowMedian, comparableSellers } = item.deal;
        console.log(`    ${money(belowMedian)} below the median asking price with fees across ${comparableSellers} comparable sellers.`);
      }
      if (item.priceDrop)
        console.log(`    Asking price fell by ${money(item.priceDrop.amount)} since the previous price observation.`);
      if (item.url) console.log(`    ${item.url}`);
    }
  }
  if (basket.missing.length) {
    console.log(
      `\nStill needed: ${basket.missing.map((want) => `${want.qty} ${want.kind}`).join(", ")}.`,
    );
  }
  for (const warning of meta.warnings ?? []) console.log(`\n${warning}`);
  if (result.nearMatches?.length) {
    console.log("\nWorth asking the seller");
    for (const near of result.nearMatches) {
      console.log(`  ${near.title} · ${money(near.estimatedDelivered)} estimated delivered on its own`);
      for (const question of near.questions) console.log(`    ${question}`);
      if (near.url) console.log(`    ${near.url}`);
    }
  }
  console.log(
    `\n${meta.limits} Confirm shipping and any bundle discount at checkout.`,
  );
}

try {
  if (["--help", "help", "-h"].includes(command)) {
    help();
  } else if (command === "shop") {
    if (profilePath || (stdin && demo))
      throw new Error("Use shop --stdin --json for agents, or shop [--demo] for the guided flow.");
    if (stdin) console.log(JSON.stringify(await shop(await readRequest())));
    else {
      const profile = await guidedProfile();
      console.error("This shopping session is stored locally. Scout learns when you save or skip.");
      const result = await shop({ profile, demo });
      if (json) console.log(JSON.stringify(result, null, 2));
      else await shopPrompt(result, (value) => report(value, true));
    }
  } else {
    if (!["wizard", "demo", "search", "import", "rank"].includes(command))
      throw new Error("Unknown command. Run npm run scout -- help.");
    if (stdin && (command === "wizard" || profilePath || demo))
      throw new Error("Use --stdin with search, import, rank or demo and no file arguments.");
    if (demo && (command !== "wizard" || profilePath))
      throw new Error("Use --demo with the guided wizard.");
    if (command === "wizard" && profilePath)
      throw new Error("Use wizard without a profile file, or search with a saved profile.");
    if (!stdin && !profilePath && ["import", "rank"].includes(command))
      throw new Error(
        "Provide a profile JSON file. See examples/profile.json.",
      );
    const guided = !stdin && (command === "wizard" || (command === "search" && !profilePath));
    const mode = guided ? (demo ? "demo" : "search") : command;
    let body;
    if (stdin) {
      body = await readRequest();
    } else {
      const profile = guided
        ? await guidedProfile()
        : JSON.parse(await readFile(profilePath ?? example, "utf8"));
      body = { profile };
      if (command === "import") body.links = rest;
      if (command === "rank") {
        if (rest.length !== 1) throw new Error("Provide a listings JSON file.");
        body.listings = JSON.parse(await readFile(rest[0], "utf8"));
      }
    }
    if (guided && mode === "search") console.error("Searching Vinted UK for your shortlist...");
    const { ok, result } = await runScout(mode, body);
    if (!ok) throw new Error(result.error);
    if (json && stdin) {
      const { profile, basket, meta } = result;
      console.log(JSON.stringify({ profile, basket, meta }));
    } else if (json) console.log(JSON.stringify(result, null, 2));
    else report(result);
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
