// Reuse the maintained parser and operations from the repo tested in the shopping chat.
import { searchItems, getSeller } from "../vendor/vinted-client/endpoints.js";
import { conditionTier, eligible, InputError, rankItems } from "./engine.js";

export class ProviderError extends Error {
  constructor(message) {
    super(message);
    this.name = "ProviderError";
  }
}
const ORIGIN = "https://www.vinted.co.uk";
const REQUEST_LIMIT = 32;
const DETAIL_CHECK_LIMIT = 16;
const SELLER_CHECK_LIMIT = 9;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
export class PublicVintedTransport {
  constructor({ fetcher = fetch, delay = 2200, timeout = 12000 } = {}) {
    this.fetcher = fetcher;
    this.delay = delay;
    this.timeout = timeout;
    this.cookie = "";
    this.next = 0;
    this.ready = false;
    this.blocked = false;
    this.calls = 0;
  }
  async request(path, accept = "text/html", redirects = 0) {
    if (this.blocked)
      throw new ProviderError(
        "Vinted has blocked this connection. Live search has stopped. Try again later or use listing import.",
      );
    if (++this.calls > REQUEST_LIMIT)
      throw new ProviderError(
        "This search reached its request limit. Try a narrower brief.",
      );
    const url = new URL(path, ORIGIN);
    if (url.origin !== ORIGIN)
      throw new ProviderError("Only UK Vinted listings are supported.");
    await pause(Math.max(0, this.next - Date.now()));
    this.next = Date.now() + this.delay;
    let response;
    try {
      response = await this.fetcher(url.href, {
        headers: {
          Accept: accept,
          "Accept-Language": "en-GB,en;q=0.9",
          ...(this.cookie ? { Cookie: this.cookie } : {}),
        },
        signal: AbortSignal.timeout(this.timeout),
        redirect: "manual",
      });
    } catch {
      throw new ProviderError(
        "Vinted did not respond. Try again later or rank listing details you already have.",
      );
    }
    if ([401, 403, 429].includes(response.status)) {
      this.blocked = true;
      await response.body?.cancel();
      throw new ProviderError(
        `Vinted declined live access (${response.status}). No bypass or automatic retry was attempted.`,
      );
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location || redirects >= 1)
        throw new ProviderError("Vinted redirected this request unexpectedly.");
      const target = new URL(location, url);
      const originalItem = url.pathname.match(/^\/items\/(\d+)(?:-|$)/)?.[1];
      const targetItem = target.pathname.match(/^\/items\/(\d+)(?:-|$)/)?.[1];
      if (
        target.origin !== ORIGIN ||
        target.username ||
        target.password ||
        !originalItem ||
        targetItem !== originalItem
      )
        throw new ProviderError("Vinted redirected this request unexpectedly.");
      return this.request(target.href, accept, redirects + 1);
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new ProviderError(
        `Vinted returned ${response.status}. Try again later.`,
      );
    }
    return response;
  }
  async bootstrap() {
    if (this.ready) return;
    const r = await this.request("/catalog");
    const cookies = r.headers.getSetCookie?.() || [];
    this.cookie = cookies
      .map((s) => s.split(";")[0])
      .filter((s) => s.slice(s.indexOf("=") + 1))
      .join("; ");
    await r.body?.cancel();
    this.ready = true;
  }
  async pageGet(country, path, parse) {
    if (country !== "uk")
      throw new ProviderError(
        "Only the UK marketplace is supported in this beta.",
      );
    await this.bootstrap();
    const r = await this.request(path);
    const text = await r.text();
    if (/captcha-delivery|cf-chl-|verify you are human/i.test(text)) {
      this.blocked = true;
      throw new ProviderError(
        "Vinted requested a security check. Live search has stopped.",
      );
    }
    return parse(text);
  }
  async apiGet(country, path) {
    await this.bootstrap();
    return (await this.request(path, "application/json")).json();
  }
  async fetchHtml(url) {
    const r = await this.request(url);
    return { status: r.status, body: await r.text() };
  }
}

export function parseListingUrl(value) {
  let u;
  try {
    u = new URL(value);
  } catch {
    throw new InputError("Paste a full Vinted UK listing link.");
  }
  const m = u.pathname.match(/^\/items\/(\d+)(?:-[^/]*)?\/?$/);
  if (
    u.protocol !== "https:" ||
    u.hostname !== "www.vinted.co.uk" ||
    u.port ||
    u.username ||
    u.password ||
    !m
  )
    throw new InputError("Use a https://www.vinted.co.uk/items/ listing link.");
  return { id: Number(m[1]), url: `${ORIGIN}${u.pathname.replace(/\/$/, "")}` };
}

function clean(item, kind) {
  return {
    id: String(item.id),
    title: String(item.title).slice(0, 180),
    brand: String(item.brand || ""),
    kind,
    price: Number(item.price),
    currency: item.currency,
    size: String(item.size || ""),
    description: String(item.description || "").slice(0, 3000),
    url: parseListingUrl(item.url).url,
    photoUrl: validImage(item.photoUrl || item.photos?.[0]),
    sellerId: item.seller?.id ? String(item.seller.id) : null,
    sellerName: item.seller?.username || "",
    condition: String(item.condition || "Not specified"),
    available: item.raw?.ld?.offers?.availability !== "OutOfStock",
    observedAt: new Date().toISOString(),
  };
}
function validImage(value) {
  try {
    const u = new URL(value);
    return u.protocol === "https:" &&
      /^images\d*\.vinted\.net$/.test(u.hostname)
      ? u.href
      : null;
  } catch {
    return null;
  }
}
function publicDetail(html) {
  const m = html.match(
    /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/,
  );
  if (!m)
    throw new ProviderError(
      "This listing could not be read. It may have sold or been removed.",
    );
  let ld;
  try {
    ld = JSON.parse(m[1]);
  } catch {
    throw new ProviderError("Vinted returned an unreadable listing.");
  }
  if (Array.isArray(ld)) ld = ld.find((x) => x["@type"] === "Product");
  if (!ld || ld["@type"] !== "Product")
    throw new ProviderError("This page is not a readable listing.");
  const price = Number(ld.offers?.price),
    included = html.match(/aria-label="£([\d.,]+) includes Vinted fee"/)?.[1];
  const fee = included
    ? Math.round((Number(included.replace(/,/g, "")) - price) * 100) / 100
    : null;
  const size = html
    .match(/itemprop="size"[^>]*>\s*<span[^>]*>\s*([^<]{1,70})</i)?.[1]
    ?.trim();
  return {
    ld,
    price,
    fee: Number.isFinite(fee) && fee >= 0 ? fee : null,
    size,
  };
}

export async function readListing(client, reference, kind) {
  const { id, url } = parseListingUrl(reference);
  const { body } = await client.fetchHtml(url);
  const { ld, price, fee, size } = publicDetail(body);
  const sellerId = body.match(/href="\/member\/(\d+)/)?.[1];
  return {
    id: String(id),
    title: String(ld.name || "").slice(0, 180),
    brand: String(ld.brand?.name || ""),
    kind,
    price,
    currency: ld.offers?.priceCurrency,
    size: size || "",
    description: String(ld.description || "").slice(0, 3000),
    url,
    photoUrl: validImage(Array.isArray(ld.image) ? ld.image[0] : ld.image),
    sellerId: sellerId || null,
    sellerName: "",
    condition: ld.offers?.itemCondition?.split("/").pop() || "Not specified",
    available: ld.offers?.availability?.split("/").pop() === "InStock",
    fee,
    observedAt: new Date().toISOString(),
  };
}

export async function discover(
  profile,
  { client = new PublicVintedTransport(), onProgress = () => {} } = {},
) {
  const items = [],
    warnings = [],
    seen = new Set();
  const brands = profile.brands.length ? profile.brands : [""];
  for (const want of profile.wants) {
    for (const brand of brands) {
      const kind =
        want.kind === "trousers" || want.kind === "shoes"
          ? want.kind
          : want.kind.replace(/s$/, "");
      const collar =
        want.kind === "shirts" && profile.collar !== null
          ? String(Math.round((profile.collar / 2.54) * 2) / 2)
          : "";
      const query = [brand, kind, collar].filter(Boolean).join(" ");
      onProgress(query);
      try {
        const r = await searchItems(client, {
          query,
          country: "uk",
          categoryId:
            profile.department === "men"
              ? 2050
              : profile.department === "women"
                ? 1904
                : undefined,
          priceMax: profile.budget - profile.delivery,
          condition: ["good", "very_good", "new_without_tags", "new_with_tags"],
          perPage: 96,
          sortBy: "relevance",
        });
        for (const i of r.items) {
          const key = `${want.kind}:${i.id}`;
          if (seen.has(key)) continue;
          seen.add(key);
          items.push(clean(i, want.kind));
        }
      } catch (e) {
        if (client.blocked || !items.length) throw e;
        warnings.push(`${query}: ${e.message}`);
      }
    }
  }
  // Validate and enrich a bounded shortlist, prioritising size-compatible results.
  const relaxed = { ...profile, strictFit: false };
  const ranked = rankItems(items, relaxed);
  const countsBySeller = new Map();
  for (const item of ranked) {
    if (!item.sellerId || item.fit.status !== "match") continue;
    if (!countsBySeller.has(item.sellerId)) countsBySeller.set(item.sellerId, new Map());
    const counts = countsBySeller.get(item.sellerId);
    counts.set(item.kind, (counts.get(item.kind) ?? 0) + 1);
  }
  const groups = profile.wants.map((want) => {
    const matching = ranked.filter((item) => item.kind === want.kind);
    const bundles = matching.filter((item) => {
      const counts = countsBySeller.get(item.sellerId);
      return item.fit.status === "match" && counts &&
        (counts.size > 1 || (want.qty > 1 && counts.get(item.kind) > 1));
    });
    const ordered = [];
    for (const [index, item] of matching.slice(0, DETAIL_CHECK_LIMIT).entries()) {
      ordered.push(item);
      if (bundles[index]) ordered.push(bundles[index]);
    }
    return { want, candidates: [...new Set(ordered)], next: 0, checked: 0, qualified: 0 };
  });
  const refreshed = new Map();
  while (refreshed.size < DETAIL_CHECK_LIMIT && (client.calls ?? 0) < REQUEST_LIMIT - 8) {
    const [group] = groups
      .filter((g) => g.next < g.candidates.length && g.qualified < g.want.qty + 2)
      .sort((a, b) => Number(a.qualified >= a.want.qty) - Number(b.qualified >= b.want.qty) ||
        a.checked - b.checked);
    if (!group) break;
    const item = group.candidates[group.next++];
    if (refreshed.has(item.id)) continue;
    group.checked++;
    try {
      const detail = await readListing(client, item.url, item.kind);
      const listing = {
        ...item,
        ...detail,
        size: detail.size || item.size,
        sellerId: detail.sellerId || item.sellerId,
        condition: conditionTier(item.condition) ? item.condition : detail.condition,
      };
      refreshed.set(item.id, listing);
      if (eligible(listing, profile)) group.qualified++;
    } catch (e) {
      if (client.blocked) throw e;
      refreshed.set(item.id, null);
      warnings.push(`Could not recheck ${item.title}. It was left out.`);
    }
  }
  const enriched = [...refreshed.values()].filter(Boolean);
  const qualified = enriched.filter((item) => eligible(item, profile));
  const sellers = new Map();
  for (const item of qualified) {
    if (!item.sellerId) continue;
    if (!sellers.has(item.sellerId)) {
      if (sellers.size >= SELLER_CHECK_LIMIT || client.calls >= REQUEST_LIMIT) break;
      try {
        const s = await getSeller(client, Number(item.sellerId), "uk");
        sellers.set(item.sellerId, {
          name: s.username,
          country: s.countryCode,
          stars: s.feedbackReputation
            ? Math.round(s.feedbackReputation * 50) / 10
            : null,
          reviews: s.feedbackCount,
        });
      } catch (e) {
        if (client.blocked) throw e;
        sellers.set(item.sellerId, null);
      }
    }
  }
  const checked = qualified
    .filter((i) => sellers.get(i.sellerId)?.country === "UK")
    .map((i) => {
      const s = sellers.get(i.sellerId);
      return {
        ...i,
        sellerName: s.name,
        sellerStars: s.stars,
        sellerReviews: s.reviews,
      };
    });
  if (checked.length < qualified.length)
    warnings.push("Listings with unverified UK seller location were left out.");
  return {
    items: checked,
    comparables: items.map((item) => refreshed.has(item.id) ? refreshed.get(item.id) : item).filter(Boolean),
    meta: {
      mode: "live",
      source: "Vinted UK via googlarz/vinted-mcp-cli",
      searched: items.length,
      detailChecked: enriched.length,
      coverage: groups.map((group) => ({
        kind: group.want.kind,
        detailAttempts: group.checked,
        eligibleAfterDetail: group.qualified,
        eligibleAfterSellerCheck: checked.filter((item) => item.kind === group.want.kind).length,
      })),
      warnings,
      limits:
        "Bounded search, not the entire marketplace. Label photos and authenticity have not been verified.",
    },
  };
}

export async function importListings(
  profile,
  links,
  { client = new PublicVintedTransport() } = {},
) {
  if (!Array.isArray(links) || links.length < 1 || links.length > 8)
    throw new InputError("Paste between one and eight listing links.");
  const { kindMatches } = await import("./engine.js");
  const items = [];
  for (const link of [...new Set(links)]) {
    const item = await readListing(client, link, "shirts");
    item.kind =
      profile.wants.find((w) => kindMatches(item, w.kind))?.kind || "other";
    if (item.sellerId) {
      const s = await getSeller(client, Number(item.sellerId), "uk");
      if (s.countryCode !== "UK") continue;
      item.sellerName = s.username;
      item.sellerStars = s.feedbackReputation * 5;
      item.sellerReviews = s.feedbackCount;
    }
    // A matching size must be present in the title or description if markup does not expose it.
    items.push(item);
  }
  return {
    items,
    meta: {
      mode: "import",
      searched: links.length,
      warnings: [],
      limits:
        "Imported listings only. Label photos and authenticity have not been verified.",
    },
  };
}
