import { readFile, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { assessFit, disclosedDefects, listingStyleEvidence, makeResult, validateProfile } from "../src/engine.js";
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

function audit(corpus) {
  if (corpus.version !== 1 || !Array.isArray(corpus.condition) || !Array.isArray(corpus.fit) ||
      !Array.isArray(corpus.baskets)) throw new Error("Use a version 1 labelled audit corpus.");
  const condition = { truePositive: 0, falsePositive: 0, falseNegative: 0, trueNegative: 0, errors: [] };
  for (const { id, title, description, defective } of corpus.condition) {
    if (typeof defective !== "boolean") throw new Error(`Missing condition label for ${id}.`);
    const found = disclosedDefects(`${title} ${description || ""}`);
    condition[found ? defective ? "truePositive" : "falsePositive" : defective ? "falseNegative" : "trueNegative"]++;
    if (found !== defective) condition.errors.push({ id, expected: defective, found });
  }
  const fitErrors = corpus.fit.flatMap(({ item, profile, expected }) => {
    if (!["match", "unknown", "excluded"].includes(expected)) throw new Error(`Invalid fit label for ${item.id}.`);
    const found = assessFit(item, validateProfile(profile)).status;
    return found === expected ? [] : [{ id: item.id, expected, found }];
  });
  const styleCases = corpus.style ?? [];
  const styleErrors = styleCases.flatMap(({ item, term, expected }) => {
    if (typeof expected !== "boolean") throw new Error(`Missing style label for ${item.id}.`);
    const found = listingStyleEvidence(item, [term]).length > 0;
    return found === expected ? [] : [{ id: item.id, term, expected, found }];
  });
  const bad = new Set(corpus.condition.filter((item) => item.defective).map((item) => String(item.id)));
  const unconfirmed = new Set(corpus.fit.filter((entry) => entry.expected !== "match").map((entry) => String(entry.item.id)));
  const baskets = corpus.baskets.map((snapshot) => {
    const profile = validateProfile(snapshot.profile);
    const pool = rows([...snapshot.catalogue, ...snapshot.wardrobe]);
    const comparable = snapshot.comparables ? rows(snapshot.comparables) : pool;
    const { basket } = makeResult(pool, profile, { mode: "manual" }, comparable);
    const flagged = basket.items.filter((item) => bad.has(item.id) ||
      (snapshot.unconfirmedFitIds ?? []).includes(item.id) && unconfirmed.has(item.id));
    return {
      name: snapshot.name, filled: basket.items.length, total: basket.cost.total,
      parcels: basket.cost.parcels, flaggedPicks: flagged.map((item) => item.id),
      picked: basket.items.map((item) => item.id), missing: basket.missing,
    };
  });
  return { source: corpus.source, condition, fit: {
    cases: corpus.fit.length, correct: corpus.fit.length - fitErrors.length, errors: fitErrors,
  }, style: { cases: styleCases.length, correct: styleCases.length - styleErrors.length, errors: styleErrors }, baskets };
}

function compare(standard, deeper) {
  if (JSON.stringify(validateProfile(standard.profile)) !== JSON.stringify(validateProfile(deeper.profile)))
    throw new Error("Capture both searches with the same brief.");
  const baseline = replay(standard);
  const expanded = replay(deeper);
  const first = baseline.withWardrobes;
  const second = expanded.withWardrobes;
  const equalCoverage = JSON.stringify(first.missing) === JSON.stringify(second.missing);
  return { baseline, expanded, extraFilled: second.filled - first.filled,
    savingsAtEqualCoverage: equalCoverage && first.filled ? Math.round((first.total - second.total) * 100) / 100 : null,
    newPicks: second.picked.filter(id => !first.picked.includes(id)),
    captureGapSeconds: Math.round(Math.abs(Date.parse(standard.capturedAt) - Date.parse(deeper.capturedAt)) / 1000) || 0 };
}

try {
  const [command, ...options] = process.argv.slice(2);
  const deep = options.includes("--deep");
  const args = options.filter((option) => option !== "--deep");
  if (command === "capture" && args.length === 2) {
    const input = await readJson(args[0]);
    const profile = validateProfile(input);
    const start = performance.now();
    let snapshot;
    const found = await discover(profile, { deep, onSnapshot: (data) => { snapshot = data; } });
    const record = { version: 1, source: "live_capture", name: args[0],
      profile: input, depth: deep ? "deep" : "standard", liveDiscoveryMs: Math.round(performance.now() - start), ...snapshot,
      discovery: {
        searched: found.meta.searched, queries: found.meta.queryCount, detailChecked: found.meta.detailChecked,
        wardrobesChecked: found.meta.wardrobesChecked, wardrobeItemsSeen: found.meta.wardrobeItemsSeen,
        wardrobeDetailAttempts: found.meta.wardrobeDetailAttempts, wardrobeMatches: found.meta.wardrobeMatches,
        coverage: found.meta.coverage, warnings: found.meta.warnings,
      } };
    await writeFile(args[1], JSON.stringify(record, null, 2) + "\n", { flag: "wx" });
    console.log(JSON.stringify(replay(record), null, 2));
  } else if (command === "replay" && args.length) {
    const results = await Promise.all(args.map(async (file) => replay(await readJson(file))));
    console.log(JSON.stringify(results, null, 2));
  } else if (command === "audit" && args.length === 1) {
    console.log(JSON.stringify(audit(await readJson(args[0])), null, 2));
  } else if (command === "compare" && args.length === 2) {
    console.log(JSON.stringify(compare(...await Promise.all(args.map(readJson))), null, 2));
  } else if (command === "suite" && args.length === 1) {
    const suite = await readJson(args[0]);
    if (suite.version !== 1 || !Array.isArray(suite.cases) || !suite.cases.length)
      throw new Error("Use a version 1 suite with standard and expanded snapshots.");
    const cases = suite.cases.map(({ standard, expanded }) => compare(standard, expanded));
    console.log(JSON.stringify({ source: suite.source, count: cases.length,
      moreFilled: cases.filter(result => result.extraFilled > 0).length,
      fewerFilled: cases.filter(result => result.extraFilled < 0).length,
      cheaperAtEqualCoverage: cases.filter(result => result.savingsAtEqualCoverage > 0).length,
      dearerAtEqualCoverage: cases.filter(result => result.savingsAtEqualCoverage < 0).length, cases }, null, 2));
  } else {
    throw new Error("Run benchmark.mjs replay SNAPSHOT.json […], capture PROFILE.json SNAPSHOT.json [--deep], compare BASE DEEP, suite SUITE.json, or audit CORPUS.json.");
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
