import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { deflateRawSync, inflateRawSync } from "node:zlib";
import { InputError } from "./engine.js";
import { listingMemory } from "./taste.js";

const expiration = 30 * 24 * 60 * 60 * 1000;

function key() {
  const secret = process.env.SCOUT_RESUME_SECRET;
  if (!secret) throw new InputError("Resume codes are unavailable on this Scout server.");
  return createHash("sha256").update(secret).digest();
}

export function makeResumeCode(state) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const items = state.basket.items.map((item) => {
    const { id, kind, title, brand, price, fee, size, condition, currency, sellerId, sellerName, url,
      estimatedDelivered, fit, disclosures } = item;
    return { id, kind, title, brand, price, fee, size, condition, currency, sellerId, sellerName, url,
      estimatedDelivered, fit, disclosures, memory: item.memory ?? listingMemory(item) };
  });
  const snapshot = { ...state, expiresAt: Date.now() + expiration, basket: { ...state.basket, items } };
  const encrypted = Buffer.concat([cipher.update(deflateRawSync(JSON.stringify(snapshot))), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64url");
}

export function readResumeCode(code) {
  const secret = key();
  try {
    if (typeof code !== "string" || !/^[A-Za-z0-9_-]{40,32000}$/.test(code)) throw Error();
    const bytes = Buffer.from(code, "base64url");
    const decipher = createDecipheriv("aes-256-gcm", secret, bytes.subarray(0, 12));
    decipher.setAuthTag(bytes.subarray(12, 28));
    const compressed = Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]);
    const state = JSON.parse(inflateRawSync(compressed, { maxOutputLength: 180000 }));
    if (state.expiresAt <= Date.now()) throw Error();
    return state;
  } catch {
    throw new InputError("This resume code is invalid or expired. Start a new search.");
  }
}
