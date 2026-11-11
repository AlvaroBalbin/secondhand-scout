import { InputError, KINDS } from "./engine.js";

export function normalizeListings(listings) {
  if (
    !Array.isArray(listings) ||
    listings.length < 1 ||
    listings.length > 150
  ) {
    throw new InputError("Provide between one and 150 listing objects.");
  }
  return listings.map((item, index) => {
    if (
      !item ||
      typeof item !== "object" ||
      !Object.hasOwn(KINDS, item.kind) ||
      typeof item.title !== "string" ||
      !item.title.trim() ||
      !Number.isFinite(item.price) ||
      item.price <= 0
    ) {
      throw new InputError(
        `Listing ${index + 1} needs a supported kind, title and positive price.`,
      );
    }
    const field = (value, max = 150) => String(value ?? "").slice(0, max);
    let url = null;
    try {
      const link = new URL(item.url);
      if (
        link.origin === "https://www.vinted.co.uk" &&
        !link.username &&
        !link.password &&
        /^\/items\/\d+(?:-[^/]*)?\/?$/.test(link.pathname)
      )
        url = link.origin + link.pathname;
    } catch {
      /* Listings may be supplied without URLs. */
    }
    return {
      id: field(item.id || `manual-${index + 1}`),
      kind: item.kind,
      title: field(item.title),
      price: item.price,
      currency: item.currency ?? "GBP",
      size: field(item.size),
      brand: field(item.brand),
      condition: field(item.condition),
      measurements: Object.fromEntries(["pitToPitCm", "waistIn", "inseamIn"]
        .filter((key) => Number.isFinite(item.measurements?.[key]))
        .map((key) => [key, item.measurements[key]])),
      description: field(item.description, 3000),
      sellerId: field(item.sellerId) || null,
      sellerName: field(item.sellerName),
      fee: Number.isFinite(item.fee) && item.fee >= 0 ? item.fee : null,
      available: item.available !== false,
      url,
    };
  });
}
