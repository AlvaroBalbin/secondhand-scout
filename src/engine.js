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
  if (!sizes.length || sizes.length > 4 || sizes.some((s) => s.length > 12))
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
      !/sleeveless|gilet|vest/.test(t)
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
  return {
    status: match ? "match" : "unknown",
    note: match
      ? "Listed size matches. Confirm garment measurements."
      : "Size is not confirmed for your brief.",
  };
}

export function disclosedDefects(text) {
  const t = norm(text).replace(
    /(?:no|without|free of|free from)\s+(?:(?:any|visible|noticeable|major)\s+)?(?:holes?|stains?|marks?|damage|flaws?)(?:\s*(?:,|or|and)\s*(?:holes?|stains?|marks?|damage|flaws?))*/g,
    "",
  );
  return /\bstains?\b|\bholes?\b|fray|broken|(?:missing|lost)\s+(?:zip|zipper|button)|(?:zip|zipper).{0,30}(?:missing|lost)|needs?\s+(?:repair|fix)/.test(
    t,
  );
}

export function eligible(item, p) {
  if (
    !Number.isFinite(item.price) ||
    item.price <= 0 ||
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
export function rankItems(items, p) {
  const seen = new Set();
  const pool = items.filter(
    (i) => eligible(i, p) && !seen.has(i.id) && seen.add(i.id),
  );
  return pool
    .map((item) => {
      const peers = pool.filter(
        (i) => i.kind === item.kind && norm(i.brand) === norm(item.brand),
      );
      const benchmark =
        peers.length >= 4 ? median(peers.map((i) => i.price)) : null;
      const fit = assessFit(item, p),
        reasons = [
          fit.status === "match"
            ? "Listed size matches your brief"
            : "Size needs checking",
        ];
      const logo = /embroider|pony|logo/.test(norm(item.description || ""));
      if (logo) reasons.push("Seller mentions a logo; check the photo");
      if (benchmark && item.price < benchmark)
        reasons.push(
          `£${round(benchmark - item.price).toFixed(2)} below this search’s median`,
        );
      if (item.sellerReviews >= 20 && item.sellerStars >= 4.8)
        reasons.push("Strong seller feedback");
      const keywords = unique(
        norm(p.brief).match(
          /\b(?:navy|blue|white|grey|gray|green|black|pink|wool|cotton|merino|cashmere|oxford|classic|regular|slim|quilted|waxed|logo)\b/g,
        ) || [],
      );
      const matches = keywords.filter((w) =>
        norm(`${item.title} ${item.description || ""}`).includes(w),
      ).length;
      const score =
        20 +
        (fit.status === "match" ? 12 : 0) +
        Math.min(6, matches * 2) +
        (p.logos && logo ? 4 : 0) +
        (benchmark
          ? Math.max(
              -5,
              Math.min(8, ((benchmark - item.price) / benchmark) * 10),
            )
          : 0) +
        (item.sellerStars >= 4.8 ? 2 : 0) -
        (item.price / Math.max(1, p.budget)) * 8;
      return { ...item, fit, reasons, benchmark, score };
    })
    .sort((a, b) => b.score - a.score || a.price - b.price);
}

export function calculateCosts(items, p) {
  const groups = new Map();
  for (const i of items) {
    const key = i.sellerId ? String(i.sellerId) : `unknown-${i.id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(i);
  }
  const itemTotal = round(items.reduce((s, i) => s + i.price, 0));
  // Sum the visible per-listing fees, conservatively, even when a bundle may reduce them.
  const fees = round(
    items.reduce(
      (s, i) =>
        s + (Number.isFinite(i.fee) ? i.fee : round(i.price * 0.05 + 0.7)),
      0,
    ),
  );
  const delivery = round(groups.size * p.delivery);
  return {
    itemTotal,
    fees,
    delivery,
    total: round(itemTotal + fees + delivery),
    parcels: groups.size,
    feesEstimated: items.some((i) => !Number.isFinite(i.fee)),
    deliveryEstimated: true,
    groups: [...groups.entries()].map(([sellerId, a]) => ({
      sellerId,
      seller: a[0].sellerName || "Seller not verified",
      ids: a.map((i) => i.id),
      count: a.length,
      itemTotal: round(a.reduce((s, i) => s + i.price, 0)),
    })),
  };
}

export function planBasket(ranked, p) {
  let beam = [{ items: [], counts: {}, value: 0, cost: calculateCosts([], p) }];
  for (const item of ranked.slice(0, 48)) {
    const additions = [];
    for (const state of beam) {
      const want = p.wants.find((w) => w.kind === item.kind);
      if ((state.counts[item.kind] || 0) >= want.qty) continue;
      const items = [...state.items, item],
        cost = calculateCosts(items, p);
      if (cost.total > p.budget) continue;
      const counts = {
        ...state.counts,
        [item.kind]: (state.counts[item.kind] || 0) + 1,
      };
      const value =
        items.length * 100 +
        new Set(items.map((i) => i.kind)).size * 35 +
        items.reduce((s, i) => s + i.score, 0) -
        cost.total * 0.12 -
        cost.parcels * 1.5;
      additions.push({ items, counts, value, cost });
    }
    const states = [...beam, ...additions].sort(
        (a, b) => b.value - a.value || a.cost.total - b.cost.total,
      ),
      keys = new Set();
    beam = states
      .filter((s) => {
        const key = s.items
          .map((i) => i.id)
          .sort()
          .join(",");
        if (keys.has(key)) return false;
        keys.add(key);
        return true;
      })
      .slice(0, 64);
  }
  const best = beam[0];
  const missing = p.wants
    .map((w) => ({
      kind: w.kind,
      qty: Math.max(0, w.qty - (best.counts[w.kind] || 0)),
    }))
    .filter((w) => w.qty);
  return { items: best.items, cost: best.cost, missing };
}

export function makeResult(items, p, meta = {}) {
  const ranked = rankItems(items, p),
    basket = planBasket(ranked, p);
  return {
    profile: p,
    items: ranked.slice(0, 48).map(({ score, ...i }) => i),
    basket: { ...basket, items: basket.items.map(({ score, ...i }) => i) },
    meta: { checkedAt: new Date().toISOString(), ...meta },
  };
}
