import { readFile } from "node:fs/promises";
import { api } from "../src/app.js";

const args = process.argv.slice(2);
const json = args.includes("--json");
const [command = "demo", profilePath, ...rest] = args.filter(
  (arg) => arg !== "--json",
);
const example = new URL("../examples/profile.json", import.meta.url);
const money = (amount) => `£${amount.toFixed(2)}`;

function help() {
  console.log(`Secondhand Scout

npm run scout -- demo [profile.json]                   Try sample listings
npm run scout -- search profile.json                   Search Vinted UK
npm run scout -- import profile.json URL [URL ...]     Check shared listings
npm run scout -- rank profile.json listings.json       Rank supplied listings

Add --json to print machine-readable results. Edit examples/profile.json to
change your clothing types, sizes, brands, budget and delivery allowance.`);
}

function report(result) {
  const { basket, meta, profile } = result;
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
  for (const group of basket.cost.groups) {
    console.log(
      `\n${group.seller}${group.count > 1 ? ` (${group.count} listings to consider bundling)` : ""}`,
    );
    for (const id of group.ids) {
      const item = basket.items.find((entry) => entry.id === id);
      console.log(
        `  ${money(item.price)}  ${item.brand} ${item.title} (${item.size || "size unspecified"})`,
      );
      console.log(`    ${item.fit.note}`);
      if (item.url) console.log(`    ${item.url}`);
    }
  }
  if (basket.missing.length) {
    console.log(
      `\nStill needed: ${basket.missing.map((want) => `${want.qty} ${want.kind}`).join(", ")}.`,
    );
  }
  for (const warning of meta.warnings ?? []) console.log(`\n${warning}`);
  console.log(
    `\n${meta.limits} Confirm shipping and any bundle discount at checkout.`,
  );
}

try {
  if (["--help", "help", "-h"].includes(command)) {
    help();
  } else {
    if (!["demo", "search", "import", "rank"].includes(command))
      throw new Error("Unknown command. Run npm run scout -- help.");
    if (!profilePath && command !== "demo")
      throw new Error(
        "Provide a profile JSON file. See examples/profile.json.",
      );
    const profile = JSON.parse(await readFile(profilePath ?? example, "utf8"));
    const body = { profile };
    if (command === "import") body.links = rest;
    if (command === "rank") {
      if (rest.length !== 1) throw new Error("Provide a listings JSON file.");
      body.listings = JSON.parse(await readFile(rest[0], "utf8"));
    }
    const response = await api(
      new Request(`http://localhost/api/${command}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    if (json) console.log(JSON.stringify(result, null, 2));
    else report(result);
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
