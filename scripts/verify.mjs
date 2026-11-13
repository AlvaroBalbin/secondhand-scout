import { assessFit, calculateCosts, disclosedDefects, eligible, hasLogoEvidence, listingPriceNotes, listingStyleEvidence, validateProfile } from "../src/engine.js";
import { PublicVintedTransport, readListing } from "../src/provider.js";

export async function verifyBasket(last, ids, { client = new PublicVintedTransport(), read = readListing } = {}) {
  if (!last?.basket?.length) throw new Error("Search first to get a basket to verify.");
  const profile = validateProfile(last.profile);
  const requested = ids ?? last.basket.slice(0, 5).map(({ id }) => id);
  if (!Array.isArray(requested) || !requested.length || requested.length > 5 ||
      new Set(requested).size !== requested.length || requested.some(id => !last.basket.some(item => item.id === id)))
    throw new Error("Choose up to five listing IDs from the active basket.");
  const checks = [];
  const refreshed = new Map();
  for (const id of requested) {
    const prior = last.basket.find(item => item.id === id);
    if (!prior.url || client.blocked) {
      checks.push({ id, status: "unverified" });
      continue;
    }
    try {
      const item = await read(client, prior.url, prior.kind);
      if (item.id !== id || item.currency !== "GBP" || !Number.isFinite(item.price) || item.price <= 0) {
        checks.push({ id, status: "unverified" });
        continue;
      }
      if (!item.available) {
        checks.push({ id, status: "unavailable" });
        continue;
      }
      const fit = assessFit(item, profile);
      const cut = item.kind === "shirts"
        ? listingStyleEvidence(item, ["classic fit", "regular fit", "slim fit", "relaxed fit", "tailored fit"]) : [];
      const defect = disclosedDefects(item.title + " " + item.description);
      const logo = hasLogoEvidence(item);
      const questions = fit.checks?.flatMap(check => check.question ? [check.question] : []) ?? [];
      if (!questions.length && item.kind === "shirts" && !cut.length)
        questions.push("What cut is printed on the shirt label?");
      if (!questions.length && profile.logos && !logo)
        questions.push("Could you share a close-up of the logo on the outside of the garment?");
      checks.push({ id, status: "available", askingPrice: item.price, fee: item.fee,
        ...listingPriceNotes(item, profile),
        priceChanged: item.price !== prior.price, fit, cut, defect, logo, observedAt: item.observedAt,
        photos: { urls: item.photoUrls ?? (item.photoUrl ? [item.photoUrl] : []), source: item.photoSource ?? "listing_metadata", status: "unreviewed" },
        questions: questions.slice(0, 1) });
      if (item.sellerId && item.sellerId === prior.sellerId && eligible(item, profile))
        refreshed.set(id, item);
    } catch {
      checks.push({ id, status: "unverified" });
    }
  }
  return { checks, allInBasketRechecked: refreshed.size === last.basket.length,
    recheckedCost: refreshed.size === last.basket.length ? calculateCosts([...refreshed.values()], profile) : null };
}
