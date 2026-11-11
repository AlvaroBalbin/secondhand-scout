import { listingStyleEvidence } from "./engine.js";

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
  const brand = String(item.brand || "").trim().toLowerCase().replace(/^polo ralph lauren$/, "ralph lauren").slice(0, 80);
  const found = brand ? [{ field: "brand", value: brand }] : [];
  for (const [field, terms] of Object.entries(TERMS)) {
    const evidence = listingStyleEvidence(item, terms);
    const values = new Set(evidence.map(({ term }) => term === "gray" ? "grey" : term));
    if (values.has("navy")) values.delete("blue");
    if (values.has("olive")) values.delete("green");
    if (values.has("merino") || values.has("lambswool")) values.delete("wool");
    for (const value of values) found.push({ field, value });
  }
  if (listingStyleEvidence(item, ["embroidered pony logo"]).length &&
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

function weights(feedback) {
  const groups = new Map();
  for (const event of feedback) {
    if (!groups.has(event.kind)) groups.set(event.kind, new Map());
    const group = groups.get(event.kind);
    for (const trait of event.signals) {
      const key = traitKey(trait);
      group.set(key, { ...trait, valueWeight: (group.get(key)?.valueWeight ?? 0) + (event.action === "save" ? 75 : -150) });
    }
  }
  return groups;
}

export function describeTaste(feedback) {
  return {
    saves: feedback.filter((event) => event.action === "save").length,
    skips: feedback.filter((event) => event.action === "skip").length,
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

export function personalRanking(feedback, anchor = null, prefer = []) {
  const learned = weights(feedback);
  const skipped = new Map(feedback.filter((event) => event.action === "skip").map((event) => [event.id, event]));
  const requestedFields = new Set(prefer.map(styleField).filter(Boolean));
  const reference = new Set((anchor?.traits ?? []).filter((trait) => !requestedFields.has(trait.field)).map(traitKey));
  return {
    allow(item) {
      if (anchor?.id === String(item.id)) return false;
      const event = skipped.get(String(item.id));
      return !event || (event.reason === "price" && item.price <= event.price - Math.min(2, event.price * 0.1));
    },
    score(item) {
      const group = learned.get(item.kind);
      if (!group && anchor?.kind !== item.kind) return { adjustment: 0, evidence: [] };
      const evidence = [];
      let preference = 0, similarity = 0;
      for (const trait of traits(item)) {
        const key = traitKey(trait);
        const amount = group?.get(key)?.valueWeight ?? 0;
        const overridden = anchor?.kind === item.kind && requestedFields.has(trait.field);
        if (amount && !overridden) {
          preference += Math.max(-225, Math.min(225, amount));
          evidence.push({ ...trait, source: amount > 0 ? "saved" : "skipped" });
        }
        if (anchor?.kind === item.kind && reference.has(key)) {
          similarity += 100;
          evidence.push({ ...trait, source: "similar" });
        }
      }
      return { adjustment: -Math.max(-450, Math.min(600, preference + Math.min(300, similarity))),
        evidence: evidence.slice(0, 8) };
    },
  };
}
