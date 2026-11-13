import { randomUUID } from "node:crypto";
import { assessFit, InputError, listingPriceNotes, validateProfile } from "./engine.js";
import { feedbackFor, listingMemory } from "./taste.js";
import { replaceSkipped } from "../scripts/replacement.mjs";

const sessions = new Map();
const lifetime = 60 * 60 * 1000;

function present(state, response) {
  const now = Date.now();
  for (const [id, entry] of sessions) if (entry.expiresAt <= now) sessions.delete(id);
  if (sessions.size >= 200) sessions.delete(sessions.keys().next().value);
  const session = randomUUID();
  sessions.set(session, { ...state, expiresAt: now + lifetime });
  const picks = state.basket.items.map((item) => ({
    number: state.numbers.indexOf(item.id) + 1,
    saved: state.saved.includes(item.id),
    ...item,
  }));
  return { ...response, session, basket: { ...state.basket, items: picks }, picks };
}

export function startShopping(profile, response) {
  return present({
    profile, basket: response.basket, numbers: response.basket.items.map(({ id }) => id), saved: [],
  }, response);
}

export function prepareFollowUp(body) {
  const state = sessions.get(body?.session);
  if (!state || state.expiresAt <= Date.now()) throw new InputError("This shortlist has expired. Start a new search.");
  const keep = body.keep ?? [];
  if (!Array.isArray(keep) || keep.length > 12 || new Set(keep).size !== keep.length ||
      !keep.every(Number.isInteger)) throw new InputError("Send the pick numbers to keep as an array.");
  const active = (number) => Number.isInteger(number) &&
    state.basket.items.find(({ id }) => id === state.numbers[number - 1]);
  const kept = keep.map(active);
  if (kept.some((item) => !item)) throw new InputError("A pick to keep is no longer in this basket.");
  const saved = [...new Set([...state.saved, ...kept.map(({ id }) => id)])];
  const swap = body.swap;
  if (swap == null) {
    if (!kept.length) throw new InputError("Send at least one pick to keep or swap.");
    return { search: false, run: () => present({ ...state, saved }, { outcome: "kept" }) };
  }
  const target = active(swap.number);
  if (!target || saved.includes(target.id) || (swap.bundleOnly !== undefined && typeof swap.bundleOnly !== "boolean"))
    throw new InputError("Choose an active pick that you have not kept to swap.");

  return { search: true, run: async (options) => {
    const feedback = state.basket.items.filter(({ id }) => saved.includes(id))
      .map(item => feedbackFor(listingMemory(item), "save"));
    feedback.push(feedbackFor(listingMemory(target), "skip", "price"));
    const result = await replaceSkipped({
      profile: state.profile, basket: state.basket.items,
      bundleAt: swap.bundleOnly ? { [target.kind]: 1 } : {},
    }, feedback, target.id, { ...options, requireCheaperItem: true });
    const details = {
      previousTotal: state.basket.cost.total,
      leaveOpenTotal: result.leaveOpen.cost.total,
      replacedNumber: swap.number,
      bundleOnly: swap.bundleOnly === true,
      meta: result.meta,
    };
    if (!result.replacement) return present({ ...state, saved }, { ...details, outcome: "no_replacement" });

    const profile = validateProfile(state.profile);
    const replacement = result.replacement.item;
    const updated = { ...replacement, fit: assessFit(replacement, profile), ...listingPriceNotes(replacement, profile) };
    const numbers = [...state.numbers];
    numbers[swap.number - 1] = updated.id;
    const items = state.basket.items.map(item => item.id === target.id ? updated : item);
    return present({ ...state, saved, numbers, basket: { ...result.basket, items } }, { ...details, outcome: "replaced" });
  } };
}
