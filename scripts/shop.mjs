import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { runScout } from "./request.mjs";
import { replaceSkipped } from "./replacement.mjs";
import { calculateCosts, validateProfile } from "../src/engine.js";
import { normalizeListings } from "../src/listings.js";
import { describeTaste, feedbackFor, listingMemory, personalRanking, skipReasons, styleField } from "../src/taste.js";

const statePath = () => resolve(process.env.SCOUT_TASTE_FILE || join(homedir(), ".secondhand-scout", "taste.json"));
const empty = () => ({ version: 1, feedback: [], recent: [], last: null });

async function readState(file) {
  try {
    const state = JSON.parse(await readFile(file, "utf8"));
    if (state.version !== 1 || !Array.isArray(state.feedback) || !Array.isArray(state.recent))
      throw new Error("Invalid Scout taste file.");
    return state;
  } catch (error) {
    if (error.code === "ENOENT") return empty();
    throw error;
  }
}

async function store(file, state) {
  const temporary = `${file}.${process.pid}.tmp`;
  const handle = await open(temporary, "wx", 0o600);
  try {
    try {
      await handle.writeFile(JSON.stringify(state));
    } finally {
      await handle.close();
    }
    await rename(temporary, file);
  } finally {
    await unlink(temporary).catch((error) => { if (error.code !== "ENOENT") throw error; });
  }
}

function remembered(state, id) {
  const key = String(id ?? "");
  const item = state.recent.find((row) => row.id === key) ?? state.feedback.find((row) => row.id === key);
  if (!item) throw new Error("Choose a listing ID from a recent Scout shortlist.");
  return item;
}

function numbered(state) {
  return (state.last?.numbers ?? []).map((id, index) => ({ number: index + 1, id }));
}

async function feedbackTurn(state, request, file) {
  const changes = request.changes;
  if (!state.last?.basket || !Array.isArray(changes) || changes.length < 1 || changes.length > 12)
    throw new Error("Search first, then submit up to 12 save or skip choices together.");
  const events = changes.map(({ action, number, id, reason, trait }) => {
    const listedId = Number.isInteger(number) ? state.last.numbers?.[number - 1] : id;
    const item = remembered(state, listedId);
    if (item.demo) throw new Error("Use a real or supplied listing to teach Scout your taste.");
    return feedbackFor(item, action, reason, trait);
  });
  if (new Set(events.map(({ id }) => id)).size !== events.length)
    throw new Error("Give one save or skip choice per listing.");
  const changedIds = new Set(events.map(({ id }) => id));
  state.feedback = [...events, ...state.feedback.filter(({ id }) => !changedIds.has(id))].slice(0, 200);
  await store(file, state);

  const profile = validateProfile(state.last.profile);
  const personal = personalRanking(state.feedback, null, [], state.last.profile);
  const previous = state.last.basket;
  const inBasket = events.filter(({ action, id }) => action === "skip" && previous.some((item) => item.id === id));
  const focus = inBasket.find(({ reason }) => reason === "fit") ?? inBasket[0];
  const fromReplay = request.replacementListings !== undefined;
  const fallback = () => {
    const items = previous.filter((item) => personal.allow(item));
    const missing = profile.wants.map((want) => ({ kind: want.kind,
      qty: want.qty - items.filter((item) => item.kind === want.kind).length })).filter(({ qty }) => qty > 0);
    return { items, cost: calculateCosts(items, profile), missing };
  };
  let followUp = null;
  if (focus && (state.last.mode === "search" || fromReplay)) {
    try {
      const options = fromReplay ? { discover: async () => ({
        items: normalizeListings(request.replacementListings),
        meta: { mode: "replay", warnings: [], limits: "Replacement replay uses supplied listings." },
      }) } : undefined;
      followUp = await replaceSkipped(state.last, state.feedback, focus.id, options);
      if (fromReplay) followUp.meta.mode = "replay";
    } catch (error) {
      followUp = { basket: null, leaveOpen: fallback(), replacement: null, options: [],
        meta: { mode: "replacement", warnings: [error.message] } };
    }
  }
  const basket = followUp?.basket ?? followUp?.leaveOpen ?? fallback();
  const alternatives = [
    ...(followUp?.options ?? []).map(({ item }) => item),
    ...(state.last.alternatives ?? []).filter((item) => personal.allow(item)),
  ];
  updateShortlist(state, basket.items, alternatives);
  if (followUp?.replacement)
    state.last.replacementSlots = { ...state.last.replacementSlots, [focus.id]: followUp.replacement.item.id };
  await store(file, state);
  return { action: "feedback", applied: events.map(({ id, action, reason }) => ({ id, action, reason })),
    previous: { items: previous, cost: calculateCosts(previous, profile) },
    basket, followUp, alternatives: state.last.alternatives, picks: numbered(state), taste: describeTaste(state.feedback) };
}

function updateShortlist(state, basket, alternatives = [], demo = false) {
  const recent = new Map();
  const seen = new Set(basket.map(({ id }) => id));
  const available = alternatives.filter(({ id }) => {
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  }).slice(0, 6);
  for (const item of [...basket, ...available]) {
    const id = String(item.id);
    if (!recent.has(id)) recent.set(id, { ...listingMemory(item), demo });
  }
  state.last.basket = basket;
  state.last.alternatives = available;
  state.last.numbers = [...recent.keys()];
  for (const item of state.recent) if (!recent.has(item.id)) recent.set(item.id, item);
  state.recent = [...recent.values()].slice(0, 80);
}

function moreProfile(profile, anchor, style) {
  if (style == null) style = {};
  if (typeof style !== "object" || Array.isArray(style) ||
      Object.keys(style).some((key) => !["search", "prefer", "require"].includes(key)))
    throw new Error("More accepts a search phrase, preferred styles and explicit required styles.");
  if (["prefer", "require"].some((key) => style[key] !== undefined && !Array.isArray(style[key])))
    throw new Error("More style preferences and requirements must be lists.");
  const current = profile.styleByKind?.[anchor.kind] ?? {};
  const reference = anchor.traits.filter(({ field }) => field === "style" || field === "material")
    .map(({ value }) => value);
  const requested = [...(style.require ?? []), ...(style.prefer ?? [])];
  const overrides = new Set(requested.map(styleField).filter(Boolean));
  const inherited = (current.prefer ?? []).filter((term) => !overrides.has(styleField(term)));
  const prefer = [...new Set([...(style.prefer ?? []), ...inherited, ...reference])].slice(0, 4);
  const newColour = (style.require ?? []).some((term) => styleField(term) === "colour");
  const require = [...new Set([...(current.require ?? []).filter((term) => !newColour || styleField(term) !== "colour"),
    ...(style.require ?? [])])];
  return { ...profile, styleByKind: { ...profile.styleByKind, [anchor.kind]: {
    ...current, search: style.search ?? requested[0] ?? current.search ?? reference[0] ?? "",
    prefer, require,
  } } };
}

export async function shop(request, file = statePath()) {
  const action = request?.action ?? "search";
  if (action === "taste") return { action, taste: describeTaste((await readState(file)).feedback) };
  if (!["search", "more", "save", "skip", "feedback", "replace", "forget"].includes(action)) throw new Error("Unknown Scout shop action.");
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  let lock;
  try {
    lock = await open(`${file}.lock`, "wx", 0o600);
  } catch (error) {
    if (error.code === "EEXIST") throw new Error("Another Scout shopping command is using this taste file.");
    throw error;
  }
  try {
    const state = await readState(file);
    if (action === "forget") {
      await unlink(file).catch((error) => { if (error.code !== "ENOENT") throw error; });
      return { action, taste: describeTaste([]) };
    }
    if (action === "feedback") return await feedbackTurn(state, request, file);
    if (action === "save" || action === "skip") {
      const item = remembered(state, request.id);
      if (item.demo) throw new Error("Use a real or supplied listing to teach Scout your taste.");
      const event = feedbackFor(item, action, request.reason, request.trait);
      state.feedback = [event, ...state.feedback.filter((previous) => previous.id !== event.id)].slice(0, 200);
      await store(file, state);
      return { action, id: event.id, reason: event.reason, taste: describeTaste(state.feedback) };
    }
    if (action === "replace") {
      const result = await replaceSkipped(state.last, state.feedback, request.id);
      if (result.basket) {
        updateShortlist(state, result.basket.items, result.options.map(({ item }) => item));
        state.last.replacementSlots = { ...state.last.replacementSlots, [request.id]: result.replacement.item.id };
      }
      await store(file, state);
      return { action, ...result, picks: numbered(state), taste: describeTaste(state.feedback) };
    }
    const anchor = action === "more" ? remembered(state, request.id) : null;
    if (anchor && !state.last) throw new Error("Run a shopping search before requesting more like this.");
    if (anchor && !Object.hasOwn(state.last.profile.wants, anchor.kind))
      throw new Error("That listing is outside the current brief. Start a new search for its clothing type.");
    const profile = anchor ? moreProfile(state.last.profile, anchor, request.style) : request.profile;
    const mode = request.listings ? "rank" : anchor ? state.last.mode : request.demo ? "demo" : "search";
    if (mode === "rank" && !request.listings)
      throw new Error("Pass the supplied listings again to replay a more-like-this search.");
    if (mode === "rank" && (!Array.isArray(request.listings) ||
        request.listings.some((item) => typeof item?.id !== "string" || !item.id.trim())))
      throw new Error("Give each supplied listing a stable string ID for shopping feedback.");
    const feedback = request.personalise === false ? [] : state.feedback;
    const { ok, result } = await runScout(mode, { profile, listings: request.listings }, {
      personal: personalRanking(feedback, anchor,
        anchor ? [...(request.style?.prefer ?? []), ...(request.style?.require ?? [])] : [], profile),
      nearMatches: true,
    });
    if (!ok) throw new Error(result.error);
    const basketIds = new Set(result.basket.items.map(({ id }) => id));
    const alternatives = result.items.filter(({ id }) => !basketIds.has(id)).slice(0, 6);
    state.last = { profile, mode };
    updateShortlist(state, result.basket.items, alternatives, mode === "demo");
    await store(file, state);
    return { action, profile: result.profile, basket: result.basket, nearMatches: result.nearMatches,
      alternatives: state.last.alternatives, picks: numbered(state), meta: result.meta, taste: describeTaste(state.feedback) };
  } finally {
    await lock.close();
    await unlink(`${file}.lock`);
  }
}

export async function shopPrompt(initial, show) {
  let result = initial;
  show(result);
  if (!process.stdin.isTTY) return;
  const reader = createInterface({ input: process.stdin, output: process.stderr });
  try {
    while (true) {
      const input = await reader.question("\nSave 1, skip 1 fit slim fit, replace 1, more 1 navy, taste or done? ");
      const [action, index, ...rest] = input.trim().split(/\s+/);
      if (!action || action.toLowerCase() === "done") break;
      const verb = action.toLowerCase();
      if (!["save", "skip", "replace", "more", "taste"].includes(verb)) {
        console.error("Enter save, skip, replace, more, taste or done.");
        continue;
      }
      const item = result.basket.items[Number(index) - 1];
      if (verb !== "taste" && !item) {
        console.error("Choose a listing number from your basket.");
        continue;
      }
      try {
        if (verb === "more") {
          const phrase = rest.join(" ");
          result = await shop({ action: verb, id: item.id, style: phrase ? { require: [phrase] } : undefined });
          show(result);
        } else if (verb === "replace") {
          const replacement = await shop({ action: verb, id: item.id });
          show(replacement);
          if (replacement.basket) result = replacement;
        } else {
          const feedback = await shop({ action: verb, id: item?.id, reason: rest[0], trait: rest.slice(1).join(" ") || undefined });
          if (verb === "taste") console.log(JSON.stringify(feedback.taste, null, 2));
          else console.log(verb === "save" ? "Saved." : "Skipped.");
        }
      } catch (error) {
        console.error(error.message);
        if (verb === "skip") console.error(`Skip reasons: ${skipReasons.join(", ")}.`);
      }
    }
  } finally {
    reader.close();
  }
}
