export class InputError extends Error {}
export const KINDS = {
  shirts: "shirt",
  jumpers: "jumper",
  gilets: "gilet",
  jackets: "jacket",
  trousers: "trousers",
  shoes: "shoes",
};
export const round = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const norm = (s) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/[’']/g, "")
    .trim();
const unique = (a) => [...new Set(a)];

export function validateProfile(input) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new InputError("Enter a shopping brief.");
  const budget = Number(input.budget),
    delivery = Number(input.delivery ?? 4.5);
  if (!Number.isFinite(budget) || budget < 10 || budget > 5000)
    throw new InputError("Choose a budget between £10 and £5,000.");
  if (!Number.isFinite(delivery) || delivery < 0 || delivery > 30)
    throw new InputError(
      "Delivery allowance must be between £0 and £30 per seller.",
    );
  const wants = Object.entries(input.wants ?? {})
    .filter(([k, v]) => Object.hasOwn(KINDS, k) && Number(v) > 0)
    .map(([kind, qty]) => ({ kind, qty: Number(qty) }));
  if (
    !wants.length ||
    wants.length > 3 ||
    wants.some((w) => !Number.isInteger(w.qty) || w.qty > 8) ||
    wants.reduce((n, w) => n + w.qty, 0) > 12
  )
    throw new InputError(
      "Choose up to three clothing types and twelve items in total.",
    );
  const brands = unique(
    String(input.brands ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
  if (brands.length > 3 || brands.some((s) => s.length > 45))
    throw new InputError("Use up to three brand names, separated by commas.");
  const collar =
    input.collar === "" || input.collar == null ? null : Number(input.collar);
  if (
    collar !== null &&
    (!Number.isFinite(collar) || collar < 30 || collar > 60)
  )
    throw new InputError(
      "Enter a shirt collar size in centimetres, or leave it blank.",
    );
  const sizes = unique(
    String(input.sizes ?? "")
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean),
  );
  const collarOnly = collar !== null && wants.length === 1 && wants[0].kind === "shirts";
  if ((!sizes.length && !collarOnly) || sizes.length > 4 || sizes.some((s) => s.length > 12))
    throw new InputError("Enter up to four clothing sizes, such as M, L.");
  const department = ["men", "women", "any"].includes(input.department)
    ? input.department
    : "men";
  return {
    budget,
    delivery,
    wants,
    brands,
    collar,
    sizes,
    department,
    brief: String(input.brief ?? "").slice(0, 400),
    logos: !!input.logos,
    strictFit: input.strictFit !== false,
    clean: input.clean !== false,
  };
}

export function kindMatches(item, kind) {
  const t = norm(item.title);
  if (kind === "shirts")
    return (
      /\bshirt\b|oxford|button.?down/.test(t) &&
      !/t.?shirt|sweatshirt|polo shirt|rugby|short.?sleeve/.test(t)
    );
  if (kind === "jumpers")
    return (
      /jumper|sweater|cardigan|knit|pullover|crewneck/.test(t) &&
      !/sleeveless|gilet|vest/.test(t) &&
      !/\bsweatshirts?\b/.test(norm(`${item.title} ${item.description || ""}`)
        .replace(/\bnot (?:a )?sweatshirt\b/g, ""))
    );
  if (kind === "gilets")
    return /gilet|gillet|body.?warmer|vest|waistcoat/.test(t);
  if (kind === "jackets") return /jacket|coat|blazer|parka/.test(t);
  if (kind === "trousers") return /trousers|chinos|jeans|pants/.test(t);
  return /shoes|loafers|boots|trainers|sneakers|brogues/.test(t);
}

export function collarFromText(text) {
  const t = norm(text);
  let m = t.match(/\b(\d{2})\s*[-–/]\s*(\d{2})\b/);
  if (m && +m[1] >= 30 && +m[2] <= 60 && +m[2] >= +m[1])
    return { min: +m[1], max: +m[2] };
  m = t.match(
    /\b(1[4-9](?:[.,]5)?|2[0-2])\s*(?:inches|inch|in\b|[”"]|\/)\s*(?:(\d{2}))?/,
  );
  if (m) {
    const cm = round(Number(m[1].replace(",", ".")) * 2.54);
    return { min: cm, max: cm };
  }
  m = t.match(/\b(1[4-9])\s*(?:½|1\/2)(?!\d)/);
  if (m) return { min: (+m[1] + 0.5) * 2.54, max: (+m[1] + 0.5) * 2.54 };
  m = t.match(
    /(?:collar|neck|size)\s*[:=]?\s*(\d{2})(?:\s*cm)?\b|\b(\d{2})\s*cm\b|^(\d{2})$/,
  );
  const n = m ? +(m[1] || m[2] || m[3]) : 0;
  return n >= 30 && n <= 60 ? { min: n, max: n } : null;
}

export function assessFit(item, p) {
  const text = norm(`${item.title} ${item.description || ""}`),
    size = String(item.size || "").toUpperCase();
  if (
    /\b(?:boys?|girls?|kids?|childrens?|junior|youth)\b|\baged?\s+\d|\b(?:10|12|14)\s*[-/]\s*(?:12|14|16)\s*(?:years|yrs)\b|\b[slm]\s*\(?\s*(?:10|12|14)\s*[-/]\s*(?:12|14|16)\b/.test(
      text + " " + norm(size),
    )
  )
    return { status: "excluded", note: "Children’s sizing." };
  if (
    p.department === "men" &&
    /\bwomens?|ladies\b/.test(text + " " + norm(size))
  )
    return { status: "excluded", note: "Listed as womenswear." };
  if (p.department === "women" && /\bmens?\b/.test(text))
    return { status: "excluded", note: "Listed as menswear." };
  if (item.kind === "shirts" && p.collar !== null) {
    const declared = norm(item.description).match(
      /\b(?:collar|neck)(?:\s+size)?\s*[:=]?\s*\d{2}(?:[.,]5|½)?(?:\s*[-–/]\s*\d{2})?\s*(?:inches|inch|in\b|cm|["”])?/,
    )?.[0];
    const evidence =
      collarFromText(declared) ||
      collarFromText(item.title) ||
      collarFromText(size);
    if (!evidence)
      return {
        status: "unknown",
        note: "Collar size missing. Check the label photo.",
      };
    const ok = p.collar >= evidence.min - 0.6 && p.collar <= evidence.max + 0.6;
    return {
      status: ok ? "match" : "excluded",
      note: ok
        ? "Collar matches the listing text. Label photo and body fit still need checking."
        : `Collar appears to be ${round(evidence.max)} cm, outside your size.`,
    };
  }
  const tokens = size.split(/[^A-Z0-9.]+/).filter(Boolean);
  const match = p.sizes.some((s) => tokens.includes(s) || size === s);
  const letterSize = /^(?:X{0,4}S|M|X{0,4}L|[2-5]XL)$/;
  if (!match && p.sizes.length && p.sizes.every((s) => letterSize.test(s)) &&
      tokens.some((s) => letterSize.test(s)))
    return { status: "excluded", note: "Listed size is outside your requested sizes." };
  return {
    status: match ? "match" : "unknown",
    note: match
      ? "Listed size matches. Confirm garment measurements."
      : "Size is not confirmed for your brief.",
  };
}

export function disclosedDefects(text) {
  const t = norm(text).replace(
    /(?:no|without|free of|free from)\s+(?:(?:any|visible|noticeable|major)\s+)?(?:holes?|stains?|marks?|damage|flaws?|rips?|tears?)(?:\s*(?:,|or|and)\s*(?:holes?|stains?|marks?|damage|flaws?|rips?|tears?))*/g,
    "",
  );
  return /\b(?:stains?|holes?|rips?|tears?)\b|fray|broken|(?:missing|lost)\s+(?:zip|zipper|button)|(?:zip|zipper).{0,30}(?:missing|lost)|needs?\s+(?:repair|fix)/.test(
    t,
  );
}

export function eligible(item, p) {
  if (
    !Number.isFinite(item.price) ||
    item.price <= 0 ||
    !Number.isSafeInteger(itemCost(item)) ||
    item.currency !== "GBP" ||
    item.available === false
  )
    return false;
  if (
    !p.wants.some((w) => w.kind === item.kind) ||
    !kindMatches(item, item.kind)
  )
    return false;
  const brand = norm(item.brand);
  if (p.brands.length && !p.brands.some((b) => brand.includes(norm(b))))
    return false;
  if (
    /u\.?s\.?\s*polo|uspa/.test(norm(`${item.brand} ${item.title}`)) &&
    p.brands.some((b) => /ralph/i.test(b))
  )
    return false;
  if (p.clean && disclosedDefects(`${item.title} ${item.description || ""}`))
    return false;
  const f = assessFit(item, p);
  return f.status !== "excluded" && (!p.strictFit || f.status === "match");
}

function median(a) {
  const s = [...a].sort((x, y) => x - y);
  return s.length % 2
    ? s[(s.length - 1) / 2]
    : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
}
function listingKey(item) {
  const id = typeof item.url === "string"
    ? item.url.match(/^https:\/\/www\.vinted\.co\.uk\/items\/(\d+)(?:[-/?#]|$)/)?.[1]
    : null;
  return id ? `vinted:${id}` : null;
}

function sellerKey(item) {
  return item.sellerId ? `seller:${item.sellerId}` : `unknown:${item.id}`;
}

function isNewListing(seen, item) {
  const key = listingKey(item);
  const id = `id:${item.id}`;
  if (seen.has(id) || (key && seen.has(key))) return false;
  seen.add(id);
  if (key) seen.add(key);
  return true;
}

const pence = (amount) => Math.round((amount + Number.EPSILON) * 100);
const feePence = (item) => pence(Number.isFinite(item.fee) ? item.fee : item.price * 0.05 + 0.7);
const itemCost = (item) => pence(item.price) + feePence(item);

export function conditionTier(condition) {
  const label = norm(condition);
  if (/^new(?:condition| with tags| without tags)?$/.test(label)) return "new";
  if (["very good", "good", "satisfactory"].includes(label)) return label;
  return null;
}

function comparableKey(item) {
  const brand = norm(item.brand);
  const condition = conditionTier(item.condition);
  if (!brand || !condition) return null;
  const title = norm(item.title);
  const style = title.match(
    /\b(?:oxford|flannel|cardigan|waistcoat|waxed|quilted|blazer|parka|jeans|chinos|loafers|boots|trainers)\b/,
  )?.[0] || "general";
  const fibres = unique(title.match(/\b(?:cashmere|merino|lambswool|wool|cotton|linen|silk|polyester)\b/g) || []);
  const specificWool = fibres.includes("merino") || fibres.includes("lambswool");
  const materials = specificWool ? fibres.filter((fibre) => fibre !== "wool") : fibres;
  return JSON.stringify([item.kind, brand, condition, style, materials.sort()]);
}

function comparisonGroups(items, p) {
  const groups = new Map();
  const seen = new Set();
  for (const item of items) {
    if (!item.sellerId || !eligible(item, p) ||
        assessFit(item, p).status !== "match" ||
        disclosedDefects(`${item.title} ${item.description || ""}`)) continue;
    const key = comparableKey(item);
    if (!key || !isNewListing(seen, item)) continue;
    if (!groups.has(key)) groups.set(key, new Map());
    const sellers = groups.get(key);
    const seller = sellerKey(item);
    if (!sellers.has(seller)) sellers.set(seller, []);
    sellers.get(seller).push(item);
  }
  for (const sellers of groups.values()) {
    for (const [key, listings] of sellers) {
      sellers.set(key, {
        item: median(listings.map((i) => pence(i.price))),
        withFees: median(listings.map(itemCost)),
        feesEstimated: listings.some((i) => !Number.isFinite(i.fee)),
      });
    }
  }
  return groups;
}

function comparePrice(item, groups, source) {
  if (!item.sellerId) return null;
  const sellers = groups.get(comparableKey(item));
  if (!sellers) return null;
  const peers = [...sellers].filter(([key]) => key !== sellerKey(item)).map(([, price]) => price);
  if (peers.length < 4) return null;
  const typical = Math.round(median(peers.map((peer) => peer.withFees)));
  const current = itemCost(item);
  return {
    source,
    comparableSellers: peers.length,
    medianItemPrice: round(median(peers.map((peer) => peer.item)) / 100),
    medianWithFees: typical / 100,
    itemWithFees: current / 100,
    belowMedian: (typical - current) / 100,
    feesEstimated: !Number.isFinite(item.fee) || peers.some((peer) => peer.feesEstimated),
  };
}

export function rankItems(items, p, { comparables = items, source = "supplied_listings" } = {}) {
  const seen = new Set();
  const pool = items.filter((item) => eligible(item, p) && isNewListing(seen, item));
  const groups = comparisonGroups(comparables, p);
  const keywords = unique(norm(p.brief).match(
    /\b(?:navy|blue|white|grey|gray|green|black|pink|wool|cotton|merino|cashmere|oxford|classic|regular|slim|quilted|waxed|logo)\b/g,
  ) || []);
  const wearAllowance = { new: 0, "very good": 0, good: 200, satisfactory: 500 };
  return pool
    .map((item) => {
      const fit = assessFit(item, p);
      const deal = fit.status === "match" && !disclosedDefects(`${item.title} ${item.description || ""}`)
        ? comparePrice(item, groups, source)
        : null;
      const reasons = [fit.status === "match" ? "Listed size matches your brief" : "Size needs checking"];
      const listingText = norm(`${item.title} ${item.description || ""}`);
      const logo = /embroider|pony|logo/.test(listingText);
      if (logo) reasons.push("Seller mentions a logo; check the photo");
      if (deal?.belowMedian > 0)
        reasons.push(
          `£${deal.belowMedian.toFixed(2)} below the median asking price with fees across ${deal.comparableSellers} comparable sellers`,
        );
      if (item.sellerReviews >= 20 && item.sellerStars >= 4.8)
        reasons.push("Strong seller feedback");
      const matches = keywords.filter((word) => listingText.includes(word)).length;
      const discountCredit = deal
        ? pence(Math.max(0, Math.min(8, deal.belowMedian / 4, deal.medianWithFees * 0.1)))
        : 0;
      const adjustment = (wearAllowance[conditionTier(item.condition)] ?? 100) -
        Math.min(400, matches * 200) - (p.logos && logo ? 200 : 0) - discountCredit;
      return { ...item, fit, reasons, benchmark: deal?.medianItemPrice ?? null, deal, adjustment };
    })
    .sort((a, b) => Number(b.fit.status === "match") - Number(a.fit.status === "match") ||
      itemCost(a) + a.adjustment - itemCost(b) - b.adjustment ||
      itemCost(a) - itemCost(b) ||
      String(a.id).localeCompare(String(b.id)));
}

export function calculateCosts(items, p) {
  const groups = new Map();
  for (const i of items) {
    const key = sellerKey(i);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(i);
  }
  const itemTotal = items.reduce((s, i) => s + pence(i.price), 0) / 100;
  // Sum the visible per-listing fees, conservatively, even when a bundle may reduce them.
  const fees = items.reduce((s, i) => s + feePence(i), 0) / 100;
  const delivery = groups.size * pence(p.delivery) / 100;
  return {
    itemTotal,
    fees,
    delivery,
    total: round(itemTotal + fees + delivery),
    bundleDeliverySavings: (items.length - groups.size) * pence(p.delivery) / 100,
    parcels: groups.size,
    feesEstimated: items.some((i) => !Number.isFinite(i.fee)),
    deliveryEstimated: true,
    groups: [...groups.values()].map((a) => ({
      sellerId: a[0].sellerId ? String(a[0].sellerId) : `unknown-${a[0].id}`,
      seller: a[0].sellerName || "Seller not verified",
      ids: a.map((i) => i.id),
      count: a.length,
      itemTotal: a.reduce((s, i) => s + pence(i.price), 0) / 100,
    })),
  };
}

function keepBasket(frontier, candidate) {
  const key = `${candidate.counts.join(",")}:${candidate.confirmed}`;
  const existing = frontier.get(key) ?? [];
  if (existing.some((state) => state.cost <= candidate.cost && state.valueCost <= candidate.valueCost)) return;
  const remaining = existing.filter((state) => state.cost < candidate.cost || state.valueCost < candidate.valueCost);
  remaining.push(candidate);
  remaining.sort((a, b) => a.cost - b.cost);
  // Keep the cheapest path for each fulfilment state even when the value frontier is capped.
  frontier.set(key, remaining.length > 6 ? [remaining[0], ...remaining.slice(-5)] : remaining);
}

export function planBasket(ranked, p) {
  const sellers = new Map();
  const kinds = new Map(p.wants.map((want, index) => [want.kind, index]));
  const budget = Math.floor(p.budget * 100 + 1e-7);
  const postage = pence(p.delivery);
  for (const item of ranked) {
    if (!kinds.has(item.kind) || itemCost(item) + postage > budget) continue;
    const seller = sellerKey(item);
    if (!sellers.has(seller)) sellers.set(seller, []);
    sellers.get(seller).push(item);
  }
  const frontier = new Map();
  keepBasket(frontier, { items: [], counts: p.wants.map(() => 0), confirmed: 0, cost: 0, valueCost: 0 });
  for (const listings of sellers.values()) {
    const previous = [...frontier.values()].flat();
    const buyingFromSeller = new Map();
    for (const item of listings) {
      const index = kinds.get(item.kind);
      const confirmed = Number(item.fit.status === "match");
      const cost = itemCost(item);
      function extend(states, delivery) {
        for (const state of states) {
          if (state.counts[index] >= p.wants[index].qty || state.cost + cost + delivery > budget) continue;
          const counts = [...state.counts];
          counts[index]++;
          keepBasket(buyingFromSeller, {
            items: [...state.items, item],
            counts,
            confirmed: state.confirmed + confirmed,
            cost: state.cost + cost + delivery,
            valueCost: state.valueCost + cost + delivery + item.adjustment,
          });
        }
      }
      extend([...buyingFromSeller.values()].flat(), 0);
      extend(previous, postage);
    }
    for (const states of buyingFromSeller.values()) {
      for (const state of states) keepBasket(frontier, state);
    }
  }
  const coverage = (state) => state.counts.filter(Boolean).length;
  const [best] = [...frontier.values()].flat().sort((a, b) =>
    b.items.length - a.items.length || coverage(b) - coverage(a) ||
    b.confirmed - a.confirmed || a.valueCost - b.valueCost || a.cost - b.cost,
  );
  const missing = p.wants
    .map((w, index) => ({
      kind: w.kind,
      qty: w.qty - best.counts[index],
    }))
    .filter((w) => w.qty);
  return { items: best.items, cost: calculateCosts(best.items, p), missing };
}

export function makeResult(items, p, meta = {}, comparables = items) {
  const source = { live: "observed_catalogue", demo: "fictional", import: "supplied_listings" }[meta.mode];
  const ranked = rankItems(items, p, { comparables, source }),
    basket = planBasket(ranked, p);
  return {
    profile: p,
    items: ranked.slice(0, 48).map(({ adjustment, ...i }) => i),
    basket: { ...basket, items: basket.items.map(({ adjustment, ...i }) => i) },
    meta: { checkedAt: new Date().toISOString(), ...meta },
  };
}
