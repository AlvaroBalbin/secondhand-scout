import { readFile, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { makeResult, validateProfile } from "../src/engine.js";
import { normalizeListings } from "../src/listings.js";
import { discover } from "../src/provider.js";

const readJson = (file) => readFile(file, "utf8").then(JSON.parse);
const rows = (listings) => {
  if (!Array.isArray(listings)) throw new Error("Snapshot listing arrays are required.");
  const normalized = [];
  for (let offset = 0; offset < listings.length; offset += 150)
    normalized.push(...normalizeListings(listings.slice(offset, offset + 150)));
  return normalized;
};

function replay(snapshot) {
  if (snapshot.version !== 1 || !["live_capture", "synthetic"].includes(snapshot.source))
    throw new Error("Use a version 1 Scout benchmark snapshot.");
  const profile = validateProfile(snapshot.profile);
  const catalogue = rows(snapshot.catalogue);
  const wardrobe = rows(snapshot.wardrobe);
  const pool = [...catalogue, ...wardrobe];
  const comparables = snapshot.comparables ? rows(snapshot.comparables) : pool;
  const gold = Array.isArray(snapshot.suitableIds) ? new Set(snapshot.suitableIds) : null;
  const check = (listings) => {
    const start = performance.now();
    const { basket } = makeResult(listings, profile, { mode: "manual" }, comparables);
    return {
      candidates: listings.length, filled: basket.items.length,
      confirmedFit: basket.items.filter((item) => item.fit.status === "match").length,
      labelledSuitable: gold ? basket.items.filter((item) => gold.has(item.id)).length : null,
      total: basket.cost.total, parcels: basket.cost.parcels,
      missing: basket.missing, picked: basket.items.map((item) => item.id),
      rankingMs: Math.round(performance.now() - start),
    };
  };
  const catalogueOnly = check(catalogue);
  const withWardrobes = check(pool);
  return {
    name: snapshot.name, source: snapshot.source, capturedAt: snapshot.capturedAt,
    liveDiscoveryMs: snapshot.liveDiscoveryMs ?? null,
    discovery: snapshot.discovery ?? null,
    catalogueOnly, withWardrobes,
    extraItems: withWardrobes.filled - catalogueOnly.filled,
    savingsAtEqualCoverage: catalogueOnly.filled > 0 &&
      JSON.stringify(catalogueOnly.missing) === JSON.stringify(withWardrobes.missing)
      ? Math.round((catalogueOnly.total - withWardrobes.total) * 100) / 100 : null,
    labelledSuitableMissingFromPool: gold ? [...gold].filter((id) => !pool.some((item) => item.id === id)).length : null,
  };
}

try {
  const [command, ...args] = process.argv.slice(2);
  if (command === "capture" && args.length === 2) {
    const input = await readJson(args[0]);
    const profile = validateProfile(input);
    const start = performance.now();
    let snapshot;
    const found = await discover(profile, { onSnapshot: (data) => { snapshot = data; } });
    const record = { version: 1, source: "live_capture", name: args[0],
      profile: input, liveDiscoveryMs: Math.round(performance.now() - start), ...snapshot,
      discovery: {
        searched: found.meta.searched, detailChecked: found.meta.detailChecked,
        wardrobesChecked: found.meta.wardrobesChecked, wardrobeItemsSeen: found.meta.wardrobeItemsSeen,
        wardrobeDetailAttempts: found.meta.wardrobeDetailAttempts, wardrobeMatches: found.meta.wardrobeMatches,
        coverage: found.meta.coverage, warnings: found.meta.warnings,
      } };
    await writeFile(args[1], JSON.stringify(record, null, 2) + "\n", { flag: "wx" });
    console.log(JSON.stringify(replay(record), null, 2));
  } else if (command === "replay" && args.length) {
    const results = await Promise.all(args.map(async (file) => replay(await readJson(file))));
    console.log(JSON.stringify(results, null, 2));
  } else {
    throw new Error("Run node scripts/benchmark.mjs replay SNAPSHOT.json […] or capture PROFILE.json SNAPSHOT.json.");
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
