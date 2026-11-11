import { hasLogoEvidence, listingStyleEvidence } from "./engine.js";

const TERMS = {
  colour: ["navy", "olive", "burgundy", "black", "white", "cream", "grey", "gray", "blue", "green", "brown", "pink", "red", "beige"],
  material: ["merino", "lambswool", "cashmere", "wool", "cotton", "linen", "leather"],
  style: ["beaufort", "bedale", "border", "waxed", "corduroy collar", "cable knit", "v neck", "crew neck", "quarter zip",
    "oxford", "button down", "quilted", "striped", "gingham", "checked", "plain", "slim fit", "classic fit", "regular fit", "embroidered logo"],
};

export const skipReasons = ["price", "fit", "colour", "material", "style", "brand", "condition", "other"];
export function styleField(term) {
  if (typeof term !== "string") return null;
  const value = term.toLowerCase().replaceAll("-", " ");
  return Object.keys(TERMS).find((field) => TERMS[field].includes(value)) ?? null;
}

function traits(item) {
  const brand = String(item.brand || "").trim().toLowerCase()
    .replace(/^polo ralph lauren$/, "ralph lauren").replace(/^hackett london$/, "hackett").slice(0, 80);
  const found = brand ? [{ field: "brand", value: brand }] : [];
  const colourLine = String(item.description || "").match(/(?:^|\n)\s*[•*\-]?\s*colou?r\s*:\s*([^\n.]+)/i)?.[1];
  const colourTitle = (colourLine || item.title || "").split(/\b(?:with|featuring|and a)\b/i)[0]
    .replace(/\b\w+\s+(?:(?:embroidered|polo)\s+)*(?:pony|logo|crest)\b/gi, "");
  for (const [field, terms] of Object.entries(TERMS)) {
    const evidence = listingStyleEvidence(field === "colour" ? { title: colourTitle } : item, terms);
    const values = new Set(evidence.map(({ term }) => term === "gray" ? "grey" : term));
    if (values.has("navy")) values.delete("blue");
    if (values.has("olive")) values.delete("green");
    if (values.has("merino") || values.has("lambswool")) values.delete("wool");
    for (const value of values) found.push({ field, value });
  }
  if (hasLogoEvidence(item) &&
      !found.some(({ value }) => value === "embroidered logo"))
    found.push({ field: "style", value: "embroidered logo" });
  return found;
}

const traitKey = ({ field, value }) => `${field}:${value}`;

export function listingMemory(item) {
  return { id: String(item.id), kind: item.kind, title: item.title, price: item.price, traits: traits(item) };
}

export function feedbackFor(item, action, reason = "other", specificTrait) {
  if (!["save", "skip"].includes(action) || (action === "skip" && !skipReasons.includes(reason)))
    throw new Error("Choose a valid save or skip reason.");
  if (action === "save") return { ...item, action, reason: "saved", signals: item.traits };
  const options = item.traits.filter((trait) => trait.field === reason ||
    (reason === "fit" && specificTrait && trait.field === "style" && /fit$/.test(trait.value)));
  const named = typeof specificTrait === "string" ? specificTrait.trim().toLowerCase() : "";
  const signals = named ? options.filter((trait) => trait.value === named) :
    options.length === 1 ? options : [];
  if (named && !signals.length) throw new Error("That trait was not evidenced for the listing and reason.");
  return { ...item, action, reason, signals };
}

export function outcomeFor(item, outcome, fitArea) {
  if (!["bought", "fits", "too tight", "too loose"].includes(outcome))
    throw new Error("Choose bought, fits, too tight or too loose.");
  if (fitArea != null && !["chest", "collar", "shoulders", "waist", "sleeves", "length", "overall"].includes(fitArea))
    throw new Error("Choose a supported fit area.");
  const cuts = item.traits.filter(({ field, value }) => field === "style" && value.endsWith(" fit"));
  const signals = outcome === "bought" ? item.traits : cuts;
  return { ...item, action: "outcome", reason: outcome, fitArea, signals };
}

function weights(feedback) {
  const groups = new Map();
  for (const event of feedback) {
    if (!groups.has(event.kind)) groups.set(event.kind, new Map());
    const group = groups.get(event.kind);
    for (const trait of event.signals) {
      const key = traitKey(trait);
      const weight = event.action === "save" ? 75 : event.action === "skip" ? -150 :
        event.reason === "bought" ? 125 : event.reason === "fits" ? 225 : -175;
      group.set(key, { ...trait, valueWeight: (group.get(key)?.valueWeight ?? 0) + weight,
        sources: { ...group.get(key)?.sources, [event.action === "outcome" ? event.reason : event.action === "save" ? "saved" : "skipped"]: weight } });
    }
  }
  return groups;
}

export function describeTaste(feedback) {
  return {
    saves: feedback.filter((event) => event.action === "save").length,
    skips: feedback.filter((event) => event.action === "skip").length,
    outcomes: feedback.filter((event) => event.action === "outcome").map(({ id, kind, reason, fitArea }) =>
      ({ id, kind, reason, ...(fitArea ? { fitArea } : {}) })),
    byKind: Object.fromEntries([...weights(feedback)].map(([kind, group]) => {
      const ranked = [...group.values()].sort((a, b) => Math.abs(b.valueWeight) - Math.abs(a.valueWeight));
      const label = ({ field, value }) => ({ field, value });
      return [kind, {
        likes: ranked.filter((trait) => trait.valueWeight > 0).slice(0, 8).map(label),
        dislikes: ranked.filter((trait) => trait.valueWeight < 0).slice(0, 8).map(label),
      }];
    })),
  };
}

export function personalRanking(feedback, anchor = null, prefer = [], profile = {}) {
  const learned = weights(feedback);
  const skipped = new Map(feedback.filter((event) => event.action === "skip").map((event) => [event.id, event]));
  const bought = new Set(feedback.filter((event) => event.action === "outcome" && event.reason === "bought").map(({ id }) => id));
  const avoidedCuts = new Map();
  for (const event of skipped.values()) {
    if (event.reason !== "fit") continue;
    const style = profile.styleByKind?.[event.kind];
    const explicit = [style?.prefer, style?.require].filter(Array.isArray).flat()
      .map((phrase) => String(phrase).toLowerCase().replaceAll("-", " "));
    const cuts = (avoidedCuts.get(event.kind) ?? []).concat(event.signals.map(({ value }) => value)
      .filter((cut) => !explicit.includes(cut) && (learned.get(event.kind)?.get(`style:${cut}`)?.valueWeight ?? 0) < 0));
    avoidedCuts.set(event.kind, cuts);
  }
  const requestedFields = new Set(prefer.map(styleField).filter(Boolean));
  const reference = new Set((anchor?.traits ?? []).filter((trait) => !requestedFields.has(trait.field)).map(traitKey));
  return {
    allow(item) {
      if (anchor?.id === String(item.id)) return false;
      if (bought.has(String(item.id))) return false;
      if (listingStyleEvidence(item, avoidedCuts.get(item.kind)).length) return false;
      const event = skipped.get(String(item.id));
      return !event || (event.reason === "price" && item.price <= event.price - Math.min(2, event.price * 0.1));
    },
    score(item) {
      const group = learned.get(item.kind);
      if (!group && anchor?.kind !== item.kind) return { adjustment: 0, evidence: [] };
      const evidence = [];
      const itemTraits = traits(item);
      const cutUnconfirmed = avoidedCuts.get(item.kind)?.length > 0 &&
        !itemTraits.some(({ field, value }) => field === "style" && value.endsWith(" fit"));
      let preference = 0, similarity = 0;
      for (const trait of itemTraits) {
        const key = traitKey(trait);
        const learnedTrait = group?.get(key);
        const amount = learnedTrait?.valueWeight ?? 0;
        const overridden = anchor?.kind === item.kind && requestedFields.has(trait.field);
        if (amount && !overridden) {
          preference += Math.max(-225, Math.min(225, amount));
          const sources = Object.entries(learnedTrait.sources).filter(([, weight]) => Math.sign(weight) === Math.sign(amount));
          sources.sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
          evidence.push({ ...trait, source: sources[0]?.[0] ?? (amount > 0 ? "saved" : "skipped") });
        }
        if (anchor?.kind === item.kind && reference.has(key)) {
          similarity += 100;
          evidence.push({ ...trait, source: "similar" });
        }
      }
      return { adjustment: -Math.max(-450, Math.min(600, preference + Math.min(300, similarity))),
        evidence: evidence.slice(0, 8), cutUnconfirmed };
    },
  };
}
