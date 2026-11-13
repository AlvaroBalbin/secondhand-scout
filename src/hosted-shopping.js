import { randomUUID } from "node:crypto";
import { assessFit, InputError, listingPriceNotes, makeResult, validateProfile } from "./engine.js";
import { describeTaste, feedbackFor, listingMemory, outcomeFor, personalRanking } from "./taste.js";
import { discover } from "./provider.js";
import { replaceSkipped } from "../scripts/replacement.mjs";
import { verifyBasket } from "../scripts/verify.mjs";
import { makeResumeCode, readResumeCode } from "./hosted-resume.js";

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

export function startShopping(profile, response, feedback = []) {
  return present({
    profile, basket: response.basket, numbers: response.basket.items.map(({ id }) => id), saved: [], feedback,
  }, response);
}

export function prepareFollowUp(body) {
  const state = body?.resume && !body.session ? readResumeCode(body.resume) : sessions.get(body?.session);
  if (!state || state.expiresAt <= Date.now()) throw new InputError("This shortlist has expired. Start a new search.");
  const actionCount = [body.resume, body.verify, body.explore, body.fit, body.remember, body.swap].filter(Boolean).length;
  if (actionCount > 1 || ((body.resume || body.verify || body.explore || body.fit || body.remember) && body.keep?.length))
    throw new InputError("Send one follow-up action at a time.");
  if (body.remember === true) {
    return { search: false, run: () => present(state, { outcome: "remembered", resume: makeResumeCode(state) }) };
  }
  if (body.fit) {
    const pick = state.basket.items.find(({ id }) => id === state.numbers[body.fit.number - 1]);
    if (!Number.isInteger(body.fit.number) || !pick) throw new InputError("Choose an active pick number for fit feedback.");
    let event;
    try { event = outcomeFor(pick.memory ?? listingMemory(pick), body.fit.outcome, body.fit.area); }
    catch (error) { throw new InputError(error.message); }
    const feedback = [event, ...(state.feedback ?? []).filter(({ id, fitArea, reason }) =>
      id !== event.id || fitArea !== event.fitArea || (reason === "bought") !== (event.reason === "bought"))].slice(0, 30);
    const next = { ...state, feedback };
    return { search: false, run: () => present(next, { outcome: "fit_recorded", taste: describeTaste(feedback),
      ...(process.env.SCOUT_RESUME_SECRET ? { resume: makeResumeCode(next) } : {}) }) };
  }
  if (body.resume || body.verify) {
    const numbers = body.verify ?? state.basket.items.slice(0, 5).map(({ id }) => state.numbers.indexOf(id) + 1);
    if (!Array.isArray(numbers) || numbers.length > 5 || new Set(numbers).size !== numbers.length ||
        numbers.some(number => !Number.isInteger(number) ||
          !state.basket.items.some(({ id }) => id === state.numbers[number - 1])))
      throw new InputError("Choose up to five active pick numbers to recheck.");
    return { search: numbers.length > 0, run: async (options) => {
      const verified = numbers.length ? await verifyBasket({ profile: state.profile, basket: state.basket.items },
        numbers.map(number => state.numbers[number - 1]), options) : { checks: [], recheckedCost: null };
      return present(state, { outcome: body.resume ? "resumed" : "verified",
        checks: verified.checks.map(check => ({ ...check, number: state.numbers.indexOf(check.id) + 1 })),
        recheckedCost: verified.recheckedCost, taste: describeTaste(state.feedback ?? []) });
    } };
  }
  if (body.explore === true) {
    return { search: true, run: async ({ discover: search = discover } = {}) => {
      const profile = validateProfile(state.profile);
      const missing = state.basket.missing;
      const focus = missing.length ? { ...profile, wants: missing } : profile;
      const personal = personalRanking(state.feedback ?? [], null, [], state.profile);
      const found = await search(focus, { deep: true, preview: true, excludeIds: new Set(state.numbers),
        seedBasket: state.basket.items, personal });
      const result = makeResult(found.items, focus, found.meta, found.comparables, { nearMatches: true, personal });
      return present(state, { outcome: "explored", alternatives: result.items.slice(0, 5),
        nearMatches: result.nearMatches, meta: result.meta });
    } };
  }
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
    }, [...feedback, ...(state.feedback ?? [])], target.id, { ...options, requireCheaperItem: true });
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
