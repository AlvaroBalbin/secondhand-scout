import { createHash } from "node:crypto";
import { open, readFile, rename, unlink } from "node:fs/promises";
import { normalizeListings } from "./listings.js";
import { eligible } from "./engine.js";

const MAX_ROWS = 20_000;
const MAX_BYTES = 25 * 1024 * 1024;

function isoTime(value) {
  const time = Date.parse(value);
  if (typeof value !== "string" || !Number.isFinite(time)) throw new Error("Feed needs a valid capture timestamp.");
  return new Date(time).toISOString();
}

function normalizeBatch(batch) {
  if (!batch || batch.version !== 1 || typeof batch.source !== "string" ||
      !batch.source.trim() || batch.source.length > 100 || !["snapshot", "delta"].includes(batch.mode) ||
      !Array.isArray(batch.listings) || batch.listings.length > MAX_ROWS)
    throw new Error("Feed needs version 1, source, mode and listings.");
  const capturedAt = isoTime(batch.capturedAt);
  const removedIds = batch.removedIds ?? [];
  const idOk = (id) => typeof id === "string" && id.trim() === id && id.length > 0 && id.length <= 150;
  if (!Array.isArray(removedIds) || removedIds.length > MAX_ROWS || !removedIds.every(idOk) ||
      (batch.mode === "snapshot" && removedIds.length) ||
      (batch.cursor != null && (typeof batch.cursor !== "string" || batch.cursor.length > 1024)))
    throw new Error("Feed tombstones or cursor are invalid.");
  const seen = new Set(removedIds);
  const listings = [];
  for (let offset = 0; offset < batch.listings.length; offset += 150) {
    const rows = batch.listings.slice(offset, offset + 150);
    for (const row of rows) {
      if (!idOk(row?.id) || seen.has(row.id) || typeof row.available !== "boolean" || row.currency !== "GBP")
        throw new Error("Feed listings need unique stable IDs, GBP currency and explicit availability.");
      seen.add(row.id);
    }
    const clean = normalizeListings(rows);
    if (clean.some((row) => row.currency !== "GBP" || !row.url || !row.sellerId))
      throw new Error("Feed listings need GBP prices, Vinted UK links and stable seller IDs.");
    listings.push(...clean);
  }
  return { source: batch.source.trim(), mode: batch.mode, capturedAt, cursor: batch.cursor ?? null, listings, removedIds };
}

function observation(listing, observedAt) {
  return { observedAt, price: listing.price, available: listing.available };
}

export function applyFeed(previous, batch) {
  const { source, mode, capturedAt, cursor, listings, removedIds } = normalizeBatch(batch);
  if (previous && (previous.version !== 1 || previous.source !== source || !Array.isArray(previous.records)))
    throw new Error("Feed state belongs to a different source or format.");
  if ((!previous && mode === "delta") || (previous && capturedAt < previous.capturedAt))
    throw new Error("Start with a snapshot and apply updates in timestamp order.");
  const fingerprint = createHash("sha256").update(JSON.stringify({ mode, cursor, listings, removedIds })).digest("hex");
  if (previous?.capturedAt === capturedAt) {
    if (previous.fingerprint !== fingerprint) throw new Error("Different feed batches share a timestamp.");
    return previous;
  }
  const records = new Map((previous?.records ?? []).map((record) => [record.listing.id, record]));
  const active = new Set(listings.map((listing) => listing.id));
  function update(listing) {
    const old = records.get(listing.id);
    const last = old?.history.at(-1);
    const history = !last || last.price !== listing.price || last.available !== listing.available
      ? [...(old?.history ?? []), observation(listing, capturedAt)].slice(-30) : old.history;
    records.set(listing.id, {
      listing: { ...listing, observedAt: capturedAt },
      firstSeenAt: old?.firstSeenAt ?? history[0].observedAt,
      history,
    });
  }
  for (const listing of listings) update(listing);
  const removed = mode === "snapshot"
    ? [...records.keys()].filter((id) => !active.has(id)) : removedIds;
  for (const id of removed) {
    const listing = records.get(id)?.listing;
    if (listing?.available) update({ ...listing, available: false });
  }
  if (records.size > 50_000) {
    const cutoff = Date.parse(capturedAt) - 90 * 24 * 60 * 60_000;
    for (const [id, { listing }] of records)
      if (!listing.available && Date.parse(listing.observedAt) < cutoff) records.delete(id);
    if (records.size > 50_000) throw new Error("Feed state exceeds 50,000 records.");
  }
  return { version: 1, source, capturedAt, cursor, fingerprint, records: [...records.values()] };
}

export async function readFeed(path, missingOk = false) {
  try {
    const state = JSON.parse(await readFile(path, "utf8"));
    if (state.version !== 1 || !Array.isArray(state.records)) throw new Error("Invalid Scout feed state.");
    isoTime(state.capturedAt);
    return state;
  } catch (error) {
    if (missingOk && error.code === "ENOENT") return null;
    throw error;
  }
}

export async function syncFeed(path, loadBatch) {
  const lockPath = `${path}.lock`;
  const temporary = `${path}.${process.pid}.tmp`;
  const lock = await open(lockPath, "wx");
  try {
    const previous = await readFeed(path, true);
    const batch = await loadBatch(previous?.cursor);
    if (batch === null && previous) return previous;
    const state = applyFeed(previous, batch);
    if (state === previous) return previous;
    const file = await open(temporary, "wx");
    try {
      await file.writeFile(JSON.stringify(state));
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporary, path);
    return state;
  } finally {
    await lock.close();
    await unlink(lockPath);
    await unlink(temporary).catch((error) => { if (error.code !== "ENOENT") throw error; });
  }
}

export async function fetchFeedBatch(endpoint, { cursor, token, fetcher = fetch } = {}) {
  const url = new URL(endpoint);
  if (url.protocol !== "https:" || url.username || url.password)
    throw new Error("Use an authorised HTTPS feed URL without credentials in the URL.");
  if (cursor) url.searchParams.set("cursor", cursor);
  const response = await fetcher(url, {
    headers: { accept: "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    redirect: "error", signal: AbortSignal.timeout(30_000),
  });
  if (response.status === 204) return null;
  if (!response.ok || !response.body) {
    const error = new Error(`Feed returned HTTP ${response.status}.`);
    error.status = response.status;
    throw error;
  }
  const chunks = [];
  let bytes = 0;
  for await (const chunk of response.body) {
    bytes += chunk.length;
    if (bytes > MAX_BYTES) throw new Error("Feed exceeds 25 MB.");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function priceDrop({ listing, history }) {
  const previous = history.findLast((point) => point.available && point.price !== listing.price);
  return previous && previous.price > listing.price ? {
    previousPrice: previous.price, observedAt: previous.observedAt,
    amount: Math.round((previous.price - listing.price) * 100) / 100,
  } : null;
}

export function searchFeed(state, { profile, now = Date.now(), maxAgeMinutes = 60 } = {}) {
  if (!Number.isFinite(maxAgeMinutes) || maxAgeMinutes < 1 ||
      now - Date.parse(state.capturedAt) > maxAgeMinutes * 60_000 ||
      Date.parse(state.capturedAt) > now + 5 * 60_000)
    throw new Error("The listing feed is stale or has an invalid freshness limit. Refresh it before searching.");
  const matches = state.records
    .filter(({ listing }) => listing.available && (!profile || eligible(listing, profile)))
    .map((record) => ({
      ...record, firstSeenAt: record.firstSeenAt ?? record.history[0]?.observedAt ?? record.listing.observedAt,
      priceDrop: priceDrop(record),
    }));
  const sellerCounts = new Map();
  for (const { listing } of matches)
    sellerCounts.set(listing.sellerId, (sellerCounts.get(listing.sellerId) ?? 0) + 1);
  const selected = profile ? profile.wants.flatMap(({ kind }) => {
    const candidates = matches.filter(({ listing }) => listing.kind === kind)
      .sort((a, b) => a.listing.price - b.listing.price || a.listing.id.localeCompare(b.listing.id));
    const bundleOptions = candidates.filter(({ listing }) => sellerCounts.get(listing.sellerId) > 1);
    const recent = [...candidates].sort((a, b) => b.firstSeenAt.localeCompare(a.firstSeenAt));
    const reduced = candidates.filter((candidate) => candidate.priceDrop)
      .sort((a, b) => b.priceDrop.amount - a.priceDrop.amount);
    return [...new Set([...candidates.slice(0, 48), ...bundleOptions.slice(0, 24), ...recent.slice(0, 8), ...reduced.slice(0, 8)])];
  }) : matches;
  const items = selected.map(({ listing, priceDrop, firstSeenAt }) => ({ ...listing, priceDrop, firstSeenAt }));
  return { items, comparables: matches.map(({ listing }) => listing), meta: {
    mode: "feed", source: state.source, observedAt: state.capturedAt, searched: matches.length,
    considered: items.length,
    warnings: [], limits: "Availability and price reflect the most recent feed observation.",
  } };
}
