import { calculateCosts, eligible, listingStyleEvidence, validateProfile } from "../src/engine.js";
import { discoverReplacements } from "../src/provider.js";
import { personalRanking } from "../src/taste.js";

const regularCuts = ["classic fit", "regular fit", "relaxed fit", "traditional fit", "standard fit", "not slim fit"];
const narrowCuts = ["slim fit", "skinny fit", "super slim", "tailored fit"];

export async function replaceSkipped(last, feedback, id, { discover = discoverReplacements } = {}) {
  const skipped = feedback.find((entry) => entry.id === String(id) && entry.action === "skip");
  if (!skipped || !last?.basket?.length) throw new Error("Run a shopping search and skip the listing first.");
  const { kind } = skipped;
  const profile = validateProfile(last.profile);
  const target = profile.wants.find((want) => want.kind === kind);
  if (!target) throw new Error("The skipped item is outside the current shopping brief.");
  const saved = new Set(feedback.filter((entry) => entry.action === "save").map(({ id }) => id));
  const personal = personalRanking(feedback, null, [], last.profile);
  const priorCost = calculateCosts(last.basket, profile);
  const without = (item) => last.basket.filter(({ id }) => id !== item.id);
  const sameKind = last.basket.filter((item) => item.kind === kind && !saved.has(item.id));
  const tracked = last.replacementSlots?.[skipped.id];
  if (tracked && saved.has(tracked))
    throw new Error("The replacement for this slot is saved. Skip that pick to replace it.");
  const displaced = sameKind.find((item) => item.id === (tracked ?? skipped.id)) ??
    (!tracked && last.basket.filter((item) => item.kind === kind).length >= target.qty
      ? sameKind.sort((a, b) => calculateCosts(without(a), profile).total - calculateCosts(without(b), profile).total)[0]
      : undefined);
  if (!displaced && last.basket.filter((item) => item.kind === kind).length >= target.qty)
    throw new Error("All picks of that type in the basket are saved. Skip the one you want to replace.");
  const seed = (displaced ? without(displaced) : last.basket).filter((item) => saved.has(item.id) || personal.allow(item));
  const missing = (items) => profile.wants.map((want) => ({ kind: want.kind,
    qty: want.qty - items.filter((item) => item.kind === want.kind).length })).filter(({ qty }) => qty > 0);
  const leaveOpen = { items: seed, cost: calculateCosts(seed, profile), missing: missing(seed) };
  const bundleAt = last.bundleAt?.[kind];
  const bundleOnly = Number.isInteger(bundleAt) && seed.filter((item) => item.kind === kind).length + 1 >= bundleAt;
  const searchProfile = { ...profile, wants: [{ kind, qty: 1 }], strictFit: true, clean: true,
    styleByKind: { ...profile.styleByKind } };
  const nonSlim = kind === "shirts" && skipped.reason === "fit" && skipped.signals.some(({ value }) => value === "slim fit");
  if (nonSlim)
    searchProfile.styleByKind[kind] = { ...searchProfile.styleByKind[kind], search: "classic fit" };
  const matches = (item) => personal.allow(item) && (!nonSlim ||
    listingStyleEvidence(item, regularCuts).length > 0 && listingStyleEvidence(item, narrowCuts).length === 0);
  const maxTotal = displaced && (!bundleOnly || skipped.reason === "price")
    ? Math.min(profile.budget, priorCost.total - 0.01) : profile.budget;
  const maxPrice = Math.round((maxTotal - leaveOpen.cost.total) * 100) / 100;
  if (maxPrice <= 0) throw new Error("There is no budget left for a replacement.");
  const sellerIds = seed.map((item) => item.sellerId).filter(Boolean).map(String);
  const exclude = new Set([...last.basket.map((item) => item.id), skipped.id]);
  const { items, meta } = await discover(searchProfile, { kind, sellerIds, exclude, maxPrice, matches, bundleOnly });
  const options = items.filter((item) => !exclude.has(item.id) && eligible(item, searchProfile) && matches(item))
    .map((item) => ({ item, cost: calculateCosts([...seed, item], profile),
      fitEvidence: nonSlim ? listingStyleEvidence(item, regularCuts) : [],
      sameSeller: Boolean(item.sellerId && sellerIds.includes(String(item.sellerId))) }))
    .filter(({ cost, sameSeller }) => cost.total <= maxTotal && (!bundleOnly || sameSeller))
    .sort((a, b) => a.cost.total - b.cost.total || Number(b.sameSeller) - Number(a.sameSeller));
  const best = options[0];
  const filled = best ? [...seed, best.item] : null;
  const basket = filled ? { items: filled, cost: best.cost, missing: missing(filled) } : null;
  return { profile, basket, leaveOpen, previous: { item: displaced ?? null, cost: priorCost },
    replacement: best ?? null, options: options.slice(0, 5), bundleOnly, meta: {
      ...meta, mode: "replacement", limits: "Replacement listings were rechecked. Other picks use prices and availability from the previous shortlist.",
    } };
}
