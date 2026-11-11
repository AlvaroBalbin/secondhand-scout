import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { runScout } from "./request.mjs";
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
  if (!["search", "more", "save", "skip", "forget"].includes(action)) throw new Error("Unknown Scout shop action.");
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
    if (action === "save" || action === "skip") {
      const item = remembered(state, request.id);
      if (item.demo) throw new Error("Use a real or supplied listing to teach Scout your taste.");
      const event = feedbackFor(item, action, request.reason, request.trait);
      state.feedback = [event, ...state.feedback.filter((previous) => previous.id !== event.id)].slice(0, 200);
      await store(file, state);
      return { action, id: event.id, reason: event.reason, taste: describeTaste(state.feedback) };
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
    const picks = [...result.basket.items, ...result.items.slice(0, 12)];
    const recent = new Map();
    for (const item of picks) if (!recent.has(String(item.id))) {
      const memory = listingMemory(item);
      recent.set(memory.id, { ...memory, demo: mode === "demo" });
    }
    for (const item of state.recent) if (!recent.has(item.id)) recent.set(item.id, item);
    state.recent = [...recent.values()].slice(0, 80);
    state.last = { profile, mode };
    await store(file, state);
    return { action, profile: result.profile, basket: result.basket, nearMatches: result.nearMatches,
      meta: result.meta, taste: describeTaste(state.feedback) };
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
      const input = await reader.question("\nSave 1, skip 1 price, more 1 navy, taste or done? ");
      const [action, index, ...rest] = input.trim().split(/\s+/);
      if (!action || action.toLowerCase() === "done") break;
      const verb = action.toLowerCase();
      if (!["save", "skip", "more", "taste"].includes(verb)) {
        console.error("Enter save, skip, more, taste or done.");
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
