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
const marketCollars = { 39: 15.5, 40: 16, 41: 16.5, 42: 17, 43: 17.5, 44: 18 };
export function collarSearchInches(cm) {
  return marketCollars[cm] ?? Math.round((cm / 2.54) * 2) / 2;
}
const readSizes = (value) => unique(String(value ?? "").split(",").map((size) => size.trim().toUpperCase()).filter(Boolean));
const validSizes = (sizes) => sizes.length <= 4 && sizes.every((size) => size.length <= 12);
const measurementFields = {
  pitToPitCm: { label: "Pit-to-pit", min: 20, max: 110, unit: "cm", phrase: "pit[ -]+to[ -]+pit|armpit[ -]+to[ -]+armpit|p2p" },
  waistIn: { label: "Waist", min: 16, max: 80, unit: "in", phrase: "waist" },
  inseamIn: { label: "Inside leg", min: 10, max: 60, unit: "in", phrase: "inseam|inside leg" },
};

function measurementRange(value, field) {
  const range = Array.isArray(value) ? value : [value, value];
  if (range.length !== 2 || range.some((n) => typeof n !== "number" || !Number.isFinite(n) || n < field.min || n > field.max) ||
      range[0] > range[1]) throw new InputError(`Enter a valid ${field.label.toLowerCase()} size or range in ${field.unit}.`);
  return range;
}

function garmentFits(input, wants, sizes, collar) {
  const specified = input.fitByKind ?? {};
  if (typeof specified !== "object" || Array.isArray(specified) ||
      Object.keys(specified).some((kind) => !wants.some((want) => want.kind === kind)))
    throw new InputError("Set fit only for clothing types in the shopping brief.");
  return Object.fromEntries(wants.map(({ kind }) => {
    const value = specified[kind] ?? {};
    const allowed = ["sizes", ...(kind === "shirts" ? ["collarCm"] : []),
      ...(kind === "trousers" ? ["waistIn", "inseamIn"] : kind === "shoes" ? [] : ["pitToPitCm"])];
    if (typeof value !== "object" || Array.isArray(value) || Object.keys(value).some((key) => !allowed.includes(key)))
      throw new InputError(`Unsupported fit field for ${kind}.`);
    const collarCm = value.collarCm ?? (kind === "shirts" ? collar : null);
    if (collarCm !== null && (typeof collarCm !== "number" || !Number.isFinite(collarCm) || collarCm < 30 || collarCm > 60))
      throw new InputError("Enter a shirt collar size from 30 to 60 cm.");
    const measurements = Object.fromEntries(Object.entries(measurementFields)
      .filter(([key]) => Object.hasOwn(value, key))
      .map(([key, field]) => [key, measurementRange(value[key], field)]));
    const localSizes = Object.hasOwn(value, "sizes") ? readSizes(value.sizes) :
      collarCm !== null || Object.keys(measurements).length ? [] : sizes;
    if (!validSizes(localSizes) || (!localSizes.length && collarCm === null && !Object.keys(measurements).length))
      throw new InputError(`Enter up to four sizes or a measurement for ${kind}.`);
    return [kind, { sizes: localSizes, collarCm, ...measurements }];
  }));
}

const STYLE_PHRASE = /^[\p{L}\p{N}][\p{L}\p{N} '\u2019-]{0,47}$/u;

function garmentStyles(input, wants) {
  const styles = input.styleByKind ?? {};
  if (typeof styles !== "object" || Array.isArray(styles) ||
      Object.keys(styles).some((kind) => !wants.some((want) => want.kind === kind)))
    throw new InputError("Set style only for clothing types in the shopping brief.");
  const phrase = (value) => {
    if (typeof value !== "string" || !STYLE_PHRASE.test(value.trim()))
      throw new InputError("Use short clothing phrases for style preferences.");
    return value.trim().replace(/ +/g, " ");
  };
  return Object.fromEntries(Object.entries(styles).map(([kind, style]) => {
    const lists = ["prefer", "require", "avoid"];
    if (!style || typeof style !== "object" || Array.isArray(style) ||
        Object.keys(style).some((key) => key !== "search" && !lists.includes(key)) ||
        lists.some((key) => style[key] != null && (!Array.isArray(style[key]) || style[key].length > 4)))
      throw new InputError("Each clothing type can have one search phrase and up to four phrases per style list.");
    return [kind, {
      search: style.search == null || style.search === "" ? "" : phrase(style.search),
      ...Object.fromEntries(lists.map((key) => [key, unique((style[key] ?? []).map((value) => phrase(value).toLowerCase()))])),
    }];
  }));
}

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
  const sizes = readSizes(input.sizes);
  if (!validSizes(sizes) || (!sizes.length && collar === null && input.fitByKind == null))
    throw new InputError("Enter up to four clothing sizes, such as M, L.");
  const fitByKind = garmentFits(input, wants, sizes, collar);
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
    fitByKind,
    styleByKind: garmentStyles(input, wants),
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
      !/\bt[ -]?shirts?\b|\bsweatshirts?\b|\bpolo shirts?\b|\brugby\b|\bshort[ -]?sleeve/.test(t)
    );
  if (kind === "jumpers")
    return (
      /jumper|sweater|cardigan|knit|pullover|crewneck|\bv[ -]neck\b/.test(t) &&
      !/sleeveless|gilet|vest/.test(t) &&
      !/\bsweatshirts?\b/.test(norm(`${item.title} ${item.description || ""}`)
        .replace(/\bnot (?:a )?sweatshirt\b/g, ""))
    );
  if (kind === "gilets")
    return /gilet|gillet|body.?warmer|vest|waistcoat/.test(t);
  if (kind === "jackets") return /jacket|coat|blazer|parka/.test(t);
  if (kind === "trousers") return /trousers|chinos|jeans|pants/.test(t) && !/\bshorts\b/.test(t);
  return /shoes|loafers?|boots|trainers|sneakers|brogues/.test(t);
}

export function collarFromText(text) {
  const t = norm(text);
  let m = t.match(/\b(\d{2})\s*[-–/]\s*(\d{2})\b/);
  if (m && +m[1] >= 30 && +m[2] <= 60 && +m[2] >= +m[1])
    return { min: +m[1], max: +m[2] };
  m = t.match(
    /\b(1[4-9](?:[.,]5)?|2[0-2])\s*(?:inches|inch|in\b|[”"]|\/|collar\b)/,
  );
  if (m) {
    const inches = Number(m[1].replace(",", "."));
    const cm = round(inches * 2.54);
    return { min: cm, max: cm, inches };
  }
  m = t.match(/\b(1[4-9])\s*(?:½|1\/2)(?!\d)/);
  if (m) {
    const inches = Number(m[1]) + 0.5;
    return { min: inches * 2.54, max: inches * 2.54, inches };
  }
  m = t.match(
    /(?:collar|neck|size)\s*[:=]?\s*(\d{2})(?:\s*cm)?\b|\b(\d{2})\s*cm\b|^(\d{2})$/,
  );
  const n = m ? +(m[1] || m[2] || m[3]) : 0;
  return n >= 30 && n <= 60 ? { min: n, max: n } : null;
}

function sellerMetricCollars(text, title = false) {
  // A seller's own inch/cm pair can use a different conversion from Vinted.
  const pair = /\b(?:1[4-9]|2[0-2])(?:[.,]5|\s*½|\s*1\/2)?\s*(?:inches\b|inch\b|in\b|[”"])?\s*(?:[/|=(–-]\s*|\s+)(3[89]|[45]\d|60)(?:\s*[-–/]\s*(3[89]|[45]\d|60))?(?!\d|[.,]\d|\s*(?:in\b|inch|[”"]|(?:cm\s+)?(?:pit|chest|sleeve|length)\b))/g;
  const stated = /\b(?:collar|neck|size)(?:\s+size)?\s*[:=]?\s*(3[0-9]|[45]\d|60)(?:\s*[-–/]\s*(3[0-9]|[45]\d|60))?(?!\d|[.,]\d|\s*(?:in\b|inch|[”"]|(?:cm\s+)?(?:pit|chest|sleeve|length)\b))/g;
  const beforeCollar = /\b(3[0-9]|[45]\d|60)\s*cm\s+(?:collar|neck)\b/g;
  const titleSize = /\bshirt\s+\(?(3[0-9]|[45]\d|60)\)?$/g;
  return [pair, stated, beforeCollar, ...(title ? [titleSize] : [])]
    .flatMap((pattern) => [...text.matchAll(pattern)])
    .map(([, min, max = min]) => ({ min: Number(min), max: Number(max) }));
}

function collarEvidence(item) {
  const listingSize = norm(item.size);
  const dual = listingSize.match(/^(1[4-9](?:[.,]5)?|2[0-2])\s*in\s*\|\s*(\d{2})\s*cm$/);
  const description = norm(item.description);
  const declared = description.match(
    /\b(?:collar|neck)(?:\s+size)?\s*[:=]?\s*\d{2}(?:[.,]5|\s*½|\s*1\/2)?(?:\s*[-–/]\s*\d{2})?\s*(?:inches|inch|in\b|cm|["”])?/,
  )?.[0];
  const title = norm(item.title).replace(/\b\d{2}\s*cm\s+(?:pit[ -]to[ -]pit|chest|sleeve|length)\b|\b(?:pit[ -]to[ -]pit|chest|sleeve|length)\s*[:=]?\s*\d{2}\s*cm\b/g, "");
  const explicit = [...sellerMetricCollars(description), ...sellerMetricCollars(title, true)];
  if (explicit.length) return explicit;
  const seller = collarFromText(declared) || collarFromText(title);
  if (!dual) return [seller || collarFromText(listingSize)].filter(Boolean);
  const inches = Number(dual[1].replace(",", "."));
  const cm = Number(dual[2]);
  if (seller && (seller.min !== seller.max ||
      Math.abs(seller.min - inches * 2.54) > 0.02 && seller.min !== cm)) return [seller];
  return [{ min: cm, max: cm }];
}

function measured(item, key, field) {
  const supplied = item.measurements?.[key];
  if (Number.isFinite(supplied) && supplied >= field.min && supplied <= field.max) return supplied;
  const phrase = key === "inseamIn" ? "inseam|inside leg(?: length)?" : key === "waistIn" ? "waist(?: size)?" : field.phrase;
  const pattern = new RegExp(`\\b(?:${phrase})\\s*(?:measures?\\s*)?[:=~–-]?\\s*(\\d{1,3}(?:[.,]\\d+)?)\\s*(cm\\b|inches?\\b|in\\b|["”″]|'')`, "i");
  const description = String(item.description ?? "").replace(/[’′]/g, "'");
  const title = String(item.title ?? "").replace(/[’′]/g, "'");
  const match = description.match(pattern) ?? title.match(pattern);
  if (match) {
    const value = Number(match[1].replace(",", "."));
    const isCm = match[2].toLowerCase() === "cm";
    const result = field.unit === "cm" ? value * (isCm ? 1 : 2.54) : value / (isCm ? 2.54 : 1);
    return result >= field.min && result <= field.max ? round(result) : null;
  }
  if (key === "pitToPitCm") return null;
  for (const part of [description, title]) {
    const pair = part.match(/\bw\s*(\d{2})\s*(?:[x×/]\s*)?l\s*(\d{2})\b/i) ??
      part.match(/\b(\d{2})\s*(?:["”″]|'')\s*waist\s*(?:and|[x×,])\s*(\d{2})\s*(?:["”″]|'')\s*(?:inside leg|length|inseam)\b/i);
    if (pair) {
      const value = Number(pair[key === "waistIn" ? 1 : 2]);
      if (value >= field.min && value <= field.max) return value;
    }
  }
  const size = norm(item.size);
  const combined = size.match(/\bw\s*(\d{2})\s*l\s*(\d{2})\b/);
  const standalone = size.match(key === "waistIn" ? /\bw\s*(\d{2})\b/ : /\bl\s*(\d{2})\b/);
  const value = Number(combined?.[key === "waistIn" ? 1 : 2] ?? standalone?.[1]);
  return value >= field.min && value <= field.max ? value : null;
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
  const spec = p.fitByKind?.[item.kind] ?? { sizes: p.sizes, collarCm: item.kind === "shirts" ? p.collar : null };
  const checks = [];
  if (spec.collarCm !== null) {
    const evidence = collarEvidence(item);
    if (!evidence.length)
      checks.push({
        status: "unknown",
        note: "Collar size missing. Check the label photo.",
        question: "What collar size is printed on the label?",
      });
    else {
      const categoryInches = marketCollars[spec.collarCm];
      const mismatch = evidence.find(({ min, max, inches }) => categoryInches && inches !== undefined ?
        inches !== categoryInches : spec.collarCm < min - 0.6 || spec.collarCm > max + 0.6);
      checks.push({
        status: mismatch ? "excluded" : "match",
        note: mismatch ? `Collar appears to be ${round(mismatch.max)} cm, outside your size.` :
          "Collar matches the listing text. Check the label photo.",
      });
    }
  }
  if (spec.sizes.length) {
    checks.push(checkListedSize(item, spec.sizes));
  }
  for (const [key, field] of Object.entries(measurementFields)) {
    if (!spec[key]) continue;
    const value = measured(item, key, field);
    const [min, max] = spec[key];
    const margin = item.kind === "jackets" ? 0 : 0.5;
    const matches = value !== null && value >= min - margin && value <= max + margin;
    const close = !matches && value !== null && item.kind === "jackets" && key === "pitToPitCm" &&
      value >= min - 2 && value <= max + 2;
    checks.push({
      status: value === null ? "unknown" : matches ? "match" : close ? "near" : "excluded",
      note: value === null ? `${field.label} missing. Ask the seller for it.` :
        `${field.label} evidence is ${value} ${field.unit}${matches ? "." : ", outside your range."}`,
      ...(value === null ? { question: key === "pitToPitCm"
        ? "Could you measure it flat from armpit to armpit in cm?"
        : `Could you measure the ${field.label.toLowerCase()} in ${field.unit}?` } : {}),
    });
  }
  const status = checks.some((c) => c.status === "excluded") ? "excluded" :
    checks.some((c) => c.status === "near") ? "near" :
    checks.length && checks.every((c) => c.status === "match") ? "match" : "unknown";
  return { status, note: checks.map((c) => c.note).join(" ") || "Size is not confirmed for your brief.", checks };
}

const LETTER_SIZE = /^(?:X{0,4}S|M|X{0,4}L)$/;
const LETTER_WORD = "(?:[2-5]xl|x{0,4}s|m|x{0,4}l|extra[ -]+small|extra[ -]+large|small|medium|large)";
const TAGGED_SIZE = new RegExp(`\\b(?:labelled|labeled|tagged|marked|(?:label|tag)\\s+(?:says|reads))\\s*(?:as\\s+)?(?:size\\s*)?[:=]?\\s*(${LETTER_WORD})\\b`, "i");
const STATED_SIZE = new RegExp(`\\bsize\\s*[:=]?\\s*(?:men(?:'s|’s|s)?\\s+)?(${LETTER_WORD})\\b`, "i");
const SIZE_LINE = new RegExp(`^[ \\t]*(?:(?:mens?|womens?)[ \\t]+)?(${LETTER_WORD})[ \\t]*$`, "im");
const TITLE_SIZE = new RegExp(`(?:,|\\(| - |\\b(?:mens?|womens?)\\s+)\\s*(${LETTER_WORD})\\s*\\)?$`, "i");
const GARMENT_SIZE_TAIL = new RegExp(
  `\\b(?:shirt|jumper|sweater|cardigan|gilet|gillet|vest|body[ -]?warmer|jacket|coat|blazer|trousers)\\s+(${LETTER_WORD})(?:\\s+(?:mens?|womens?))?$`,
  "i",
);
const LABEL_UNAVAILABLE = /\b(?:no (?:size )?(?:label|tag)|(?:cant|cannot) see (?:a |the )?(?:size )?(?:label|tag)|(?:size )?(?:label|tag) (?:is )?(?:missing|removed|cut out))\b/;

function sizeToken(value) {
  const token = String(value).trim().toUpperCase().replace(/[- ]+/g, " ");
  const aliases = { SMALL: "S", MEDIUM: "M", LARGE: "L", "EXTRA SMALL": "XS", "EXTRA LARGE": "XL" };
  if (/^[2-5]XL$/.test(token)) return "X".repeat(Number(token[0])) + "L";
  return aliases[token] ?? token;
}

function checkListedSize(item, wanted) {
  if (item.kind === "shoes") {
    const sellerText = `${item.title ?? ""} ${item.description ?? ""}`;
    const uk = [...new Set([...sellerText.matchAll(/\buk\s*(?:size\s*)?(\d{1,2}(?:\.5)?)(?![\d.])/gi)].map((match) => match[1]))];
    const expectedUK = wanted.map((value) => value.match(/^(?:UK\s*)?(\d{1,2}(?:\.5)?)$/i)?.[1])
      .filter((value) => value && Number(value) <= 20);
    if (uk.length && expectedUK.length) {
      const status = uk.length > 1 ? "unknown" : expectedUK.includes(uk[0]) ? "match" : "excluded";
      return { status, note: uk.length > 1 ? "Seller gives conflicting UK shoe sizes." : `Seller lists UK ${uk[0]}.` };
    }
  }
  const text = [norm(item.description), norm(item.title)];
  const size = String(item.size || "").trim();
  const listed = [sizeToken(size), ...size.split(/[^A-Z0-9.]+/i).map(sizeToken)].filter(Boolean);
  const expected = wanted.map(sizeToken);
  const tagged = text.map((part) => part.match(TAGGED_SIZE)?.[1]).filter(Boolean).map(sizeToken);
  const stated = [
    text[0].match(STATED_SIZE)?.[1] ?? text[0].match(SIZE_LINE)?.[1],
    text[1].match(STATED_SIZE)?.[1] ?? text[1].match(TITLE_SIZE)?.[1] ?? text[1].match(GARMENT_SIZE_TAIL)?.[1],
  ].filter(Boolean).map(sizeToken);
  const labelMissing = text.some((part) => LABEL_UNAVAILABLE.test(part));
  const listedLetters = listed.filter((token) => LETTER_SIZE.test(token));
  const letterFit = expected.every((token) => LETTER_SIZE.test(token));
  const eligibleSizes = tagged.length ? tagged : letterFit && stated.length ? stated : listed.length ? listed : stated;
  const inconsistent = new Set(tagged).size > 1 || (!tagged.length &&
    (new Set(stated).size > 1 || listedLetters.length > 0 && stated.some((token) => !listedLetters.includes(token))));
  if (inconsistent || (labelMissing && !tagged.length))
    return { status: "unknown", note: inconsistent ? "Size evidence conflicts. Ask for the label or measurements." :
      "Seller could not confirm the size label. Ask for garment measurements." };
  const match = expected.some((token) => eligibleSizes.includes(token));
  const mismatch = !match && letterFit && eligibleSizes.some((token) => LETTER_SIZE.test(token));
  return {
    status: match ? "match" : mismatch ? "excluded" : "unknown",
    note: match ? (tagged.length ? "Seller reports a matching tag size. Check the label photo." :
      "Listed size matches. Confirm garment measurements.") : mismatch ?
      "Listed size is outside your requested sizes." : "Size is not confirmed for your brief.",
  };
}

const FASTENER = "(?:zip(?:per)?s?|buttons?|press[ -]studs?|poppers?|hanging (?:hooks?|loops?))";
const DAMAGE_WORD = "(?:holes?|stains?|staining|rips?|tears?|damage[d]?|fray(?:ed|ing)?|discolou?r(?:ation|ed|ing)|yellowing|bobbl(?:es?|ing)|pilling|fad(?:ed|ing))";
const NEGATED_ISSUE = `(?:${DAMAGE_WORD}|marks?|wear|flaws?|(?:missing|broken|lost)\\s+${FASTENER}|${FASTENER}\\s+(?:missing|broken|lost))`;
const NEGATED_LIST = new RegExp(
  `\\b(?:no|without|free (?:of|from))\\s+(?:signs? of\\s+)?(?:(?:any|obvious|visible|noticeable|major|grubby)\\s+){0,3}${NEGATED_ISSUE}\\b` +
  `(?:\\s*(?:,|\\bor\\b|\\band\\b)\\s*(?:(?:visible|noticeable|major|grubby)\\s+)?${NEGATED_ISSUE}\\b)*`,
  "g",
);
const FASTENER_DAMAGE = new RegExp(
  `\\b(?:(?:missing|lost|broken)\\s+(?:\\w+\\s+){0,2}${FASTENER}|${FASTENER}[^.!?,;\\n]{0,25}\\b(?:missing|lost|broken|came off))\\b`,
);
const MARK_DISCLOSURE = /\b(?:(?:tiny|small|light|slight|minor|faint|few|some|one|two|visible|grubby)\s+(?:\w+\s+)?marks?|(?:has|have|with|there (?:is|are))\s+marks?|marks?\s+(?:on|near|by|as shown|pictured|photographed))\b/;
const DAMAGE = new RegExp(`\\b${DAMAGE_WORD}\\b`);

export function disclosedDefects(text) {
  const remaining = norm(text).replace(NEGATED_LIST, " ")
    .replace(/\bmarks\s*(?:&|and)\s*spencer\b/g, " ")
    .replace(/\b(?:faded|fading) (?:denim )?(?:wash|effect|style)\b/g, " ");
  return DAMAGE.test(remaining) || FASTENER_DAMAGE.test(remaining) ||
    /\b(?:pulled(?:\s*\/\s*loose)?|loose)\s+threads?\b/.test(remaining) ||
    MARK_DISCLOSURE.test(remaining) || /\bneeds?\s+(?:a\s+)?(?:repair|fix|replacement)\b/.test(remaining);
}

function listingDisclosures(item) {
  const clauses = `${item.title ?? ""}\n${item.description ?? ""}`.split(/\n|[!?]|\.(?=\s|[a-z])/i);
  return clauses.flatMap((clause) => {
    const text = clause.trim();
    const alteration = /\b(?:shortened|adjusted to be short(?:er)?|taken (?:in|up)|let out|rehemmed|re-hemmed|altered|tailored to (?:fit|size))\b/i.test(text) &&
      !/\b(?:no|never|not)\s+(?:been\s+)?(?:altered|shortened|taken)|\b(?:can|could) be (?:altered|shortened)/i.test(text);
    const damage = disclosedDefects(text) || /\b(?:previously repaired|has been repaired|visible wax wear)\b/i.test(text);
    return [...(alteration ? [{ type: "alteration", text: text.slice(0, 200) }] : []),
      ...(damage ? [{ type: "damage", text: text.slice(0, 200) }] : [])];
  }).slice(0, 5);
}

function listingPriceNotes(item, profile) {
  return { estimatedDelivered: calculateCosts([item], profile).total, disclosures: listingDisclosures(item) };
}

function styleRequirements(item, p) {
  const style = p.styleByKind?.[item.kind];
  const required = style?.require ?? [];
  const evidenced = new Set(listingStyleEvidence(item, required).map(({ term }) => term));
  const barbourModels = ["beaufort", "bedale", "border"];
  const model = required.find((term) => barbourModels.includes(term));
  const wrongModel = model && !evidenced.has(model) && norm(item.brand).includes("barbour") &&
    listingStyleEvidence(item, barbourModels.filter((term) => term !== model)).length > 0;
  return {
    missing: required.filter((term) => !evidenced.has(term)),
    excluded: Boolean(wrongModel) || listingStyleEvidence(item, style?.avoid).length > 0 || required.some((term) => {
      if (evidenced.has(term)) return false;
      const phrase = term.split(/[ -]+/).join("[\\s-]+");
      const negated = new RegExp(`\\b(?:not|no|without)\\s+(?:(?:a|any|actually)\\s+)?${phrase}(?![\\p{L}\\p{N}])`, "iu");
      return negated.test(String(item.title ?? "")) || negated.test(String(item.description ?? ""));
    }),
  };
}

export function eligible(item, p, { preview = false } = {}) {
  if (
    !Number.isFinite(item.price) ||
    item.price <= 0 ||
    !Number.isSafeInteger(itemCost(item)) ||
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
  const style = styleRequirements(item, p);
  if (style.excluded || (!preview && style.missing.length) ||
      (preview && item.kind === "jackets" && p.fitByKind.jackets?.pitToPitCm && item.description && style.missing.length))
    return false;
  const f = assessFit(item, p);
  return f.status !== "excluded" && (preview || f.status === "match" || (!p.strictFit && f.status === "unknown"));
}

function median(a) {
  const s = [...a].sort((x, y) => x - y);
  return s.length % 2
    ? s[(s.length - 1) / 2]
    : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
}
function listingKey(item) {
  const id = typeof item.url === "string"
    ? item.url.match(/^https:\/\/www\.vinted\.co\.uk\/items\/(\d+)(?:[-/?#]|$)/)?.[1]
    : null;
  return id ? `vinted:${id}` : null;
}

function sellerKey(item) {
  return item.sellerId ? `seller:${item.sellerId}` : `unknown:${item.id}`;
}

function isNewListing(seen, item) {
  const key = listingKey(item);
  const id = `id:${item.id}`;
  if (seen.has(id) || (key && seen.has(key))) return false;
  seen.add(id);
  if (key) seen.add(key);
  return true;
}

const pence = (amount) => Math.round((amount + Number.EPSILON) * 100);
const feePence = (item) => pence(Number.isFinite(item.fee) ? item.fee : item.price * 0.05 + 0.7);
const itemCost = (item) => pence(item.price) + feePence(item);

export function conditionTier(condition) {
  const label = norm(condition);
  if (/^new(?:condition| with tags| without tags)?$/.test(label)) return "new";
  if (["very good", "good", "satisfactory"].includes(label)) return label;
  return null;
}

function comparableKey(item) {
  const brand = norm(item.brand);
  const condition = conditionTier(item.condition);
  if (!brand || !condition) return null;
  const title = norm(item.title);
  const style = title.match(
    /\b(?:oxford|flannel|cardigan|waistcoat|waxed|quilted|blazer|parka|jeans|chinos|loafers|boots|trainers)\b/,
  )?.[0] || "general";
  const fibres = unique(title.match(/\b(?:cashmere|merino|lambswool|wool|cotton|linen|silk|polyester)\b/g) || []);
  const specificWool = fibres.includes("merino") || fibres.includes("lambswool");
  const materials = specificWool ? fibres.filter((fibre) => fibre !== "wool") : fibres;
  return JSON.stringify([item.kind, brand, condition, style, materials.sort()]);
}

function comparisonGroups(items, p) {
  const groups = new Map();
  const seen = new Set();
  for (const item of items) {
    if (!item.sellerId || !eligible(item, p) ||
        assessFit(item, p).status !== "match" ||
        disclosedDefects(`${item.title} ${item.description || ""}`)) continue;
    const key = comparableKey(item);
    if (!key || !isNewListing(seen, item)) continue;
    if (!groups.has(key)) groups.set(key, new Map());
    const sellers = groups.get(key);
    const seller = sellerKey(item);
    if (!sellers.has(seller)) sellers.set(seller, []);
    sellers.get(seller).push(item);
  }
  for (const sellers of groups.values()) {
    for (const [key, listings] of sellers) {
      sellers.set(key, {
        item: median(listings.map((i) => pence(i.price))),
        withFees: median(listings.map(itemCost)),
        feesEstimated: listings.some((i) => !Number.isFinite(i.fee)),
      });
    }
  }
  return groups;
}

function comparePrice(item, groups, source) {
  if (!item.sellerId) return null;
  const sellers = groups.get(comparableKey(item));
  if (!sellers) return null;
  const peers = [...sellers].filter(([key]) => key !== sellerKey(item)).map(([, price]) => price);
  if (peers.length < 4) return null;
  const typical = Math.round(median(peers.map((peer) => peer.withFees)));
  const current = itemCost(item);
  return {
    source,
    comparableSellers: peers.length,
    medianItemPrice: round(median(peers.map((peer) => peer.item)) / 100),
    medianWithFees: typical / 100,
    itemWithFees: current / 100,
    belowMedian: (typical - current) / 100,
    feesEstimated: !Number.isFinite(item.fee) || peers.some((peer) => peer.feesEstimated),
  };
}

export function listingStyleEvidence(item, preferences = []) {
  return preferences.flatMap((term) => {
    if (typeof term !== "string" || !STYLE_PHRASE.test(term)) return [];
    const variants = { wax: "wax(?:ed)?", waxed: "wax(?:ed)?", chinos: "chinos?", loafers: "loafers?" };
    const phrase = variants[term.toLowerCase()] ?? term.split(/[ -]+/).join("[\\s-]+");
    const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${phrase}(?![\\p{L}\\p{N}])`, "giu");
    for (const field of ["title", "description"]) {
      const value = String(item[field] ?? "");
      for (const match of value.matchAll(pattern)) {
        const before = value.slice(Math.max(0, match.index - 45), match.index);
        const clause = value.slice(Math.max(0, match.index - 140), match.index).split(/[.!?;\n(),]/).at(-1);
        const after = value.slice(match.index + match[0].length);
        if (/\b(?:no|not|without|faux|imitation)(?:[\s-]+\w+){0,2}[\s-]+$/i.test(before) ||
            /\b(?:not the|unlike|compared (?:with|to)|rather than|instead of)\b/i.test(clause) ||
            /^[\s-]+(?:style|effect|look|imitation)\b/i.test(after)) continue;
        return [{ term, field, excerpt: match[0] }];
      }
    }
    return [];
  });
}

export function hasLogoEvidence(item) {
  const outside = (value) => String(value ?? "").replace(
    /\b(?:embroidered logo|pony logo|embroidered (?:polo )?pony)\s+(?:only\s+)?(?:on\s+the\s+|on\s+an?\s+)?(?:inner|inside|internal)\b[^.!?;\n]*/gi, "");
  return listingStyleEvidence({ title: outside(item.title), description: outside(item.description) },
    ["embroidered logo", "embroidered pony", "embroidered polo pony", "pony logo", "chest logo",
    "horse logo", "logo on the chest", "embroidered hackett logo", "embroidered crest", "chest crest"]).length > 0;
}

export function rankItems(items, p, { comparables = items, source = "supplied_listings", personal, preview = false } = {}) {
  const seen = new Set();
  const pool = items.filter((item) => eligible(item, p, { preview }) && (personal?.allow(item) ?? true) && isNewListing(seen, item));
  const groups = comparisonGroups(comparables, p);
  const keywords = unique(norm(p.brief).match(
    /\b(?:navy|blue|white|grey|gray|green|black|pink|wool|cotton|merino|cashmere|oxford|classic|regular|slim|quilted|waxed|logo)\b/g,
  ) || []);
  const wearAllowance = { new: 0, "very good": 0, good: 200, satisfactory: 500 };
  return pool
    .map((item) => {
      const fit = assessFit(item, p);
      const deal = fit.status === "match" && !disclosedDefects(`${item.title} ${item.description || ""}`)
        ? comparePrice(item, groups, source)
        : null;
      const reasons = [fit.status === "match" ? "Listed size matches your brief" : "Size needs checking"];
      const logo = hasLogoEvidence(item);
      if (logo) reasons.push("Seller mentions a logo; check the photo");
      if (deal?.belowMedian > 0)
        reasons.push(
          `£${deal.belowMedian.toFixed(2)} below the median asking price with fees across ${deal.comparableSellers} comparable sellers`,
        );
      if (item.sellerReviews >= 20 && item.sellerStars >= 4.8)
        reasons.push("Strong seller feedback");
      const scopedStyle = p.styleByKind?.[item.kind];
      const styleEvidence = listingStyleEvidence(item, scopedStyle
        ? unique([...scopedStyle.prefer, ...(scopedStyle.require ?? [])]) : keywords);
      if (styleEvidence.length)
        reasons.push(`Listing mentions ${styleEvidence.map((entry) => entry.excerpt).join(", ")}`);
      const discountCredit = deal
        ? pence(Math.max(0, Math.min(8, deal.belowMedian / 4, deal.medianWithFees * 0.1)))
        : 0;
      const taste = personal?.score(item);
      if (taste?.cutUnconfirmed) reasons.push("Cut is unspecified. Ask the seller to confirm it.");
      const adjustment = (wearAllowance[conditionTier(item.condition)] ?? 100) -
        Math.min(400, styleEvidence.length * 200) - (p.logos && logo ? 200 : 0) - discountCredit +
        (taste?.adjustment ?? 0);
      return { ...item, fit, reasons, ...listingPriceNotes(item, p), benchmark: deal?.medianItemPrice ?? null, deal, styleEvidence,
        ...(taste?.evidence.length ? { tasteEvidence: taste.evidence } : {}), adjustment };
    })
    .sort((a, b) => Number(b.fit.status === "match") - Number(a.fit.status === "match") ||
      itemCost(a) + a.adjustment - itemCost(b) - b.adjustment ||
      itemCost(a) - itemCost(b) ||
      String(a.id).localeCompare(String(b.id)));
}

export function calculateCosts(items, p) {
  const groups = new Map();
  for (const i of items) {
    const key = sellerKey(i);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(i);
  }
  const itemTotal = items.reduce((s, i) => s + pence(i.price), 0) / 100;
  // Sum the visible per-listing fees, conservatively, even when a bundle may reduce them.
  const fees = items.reduce((s, i) => s + feePence(i), 0) / 100;
  const delivery = groups.size * pence(p.delivery) / 100;
  return {
    itemTotal,
    fees,
    delivery,
    total: round(itemTotal + fees + delivery),
    bundleDeliverySavings: (items.length - groups.size) * pence(p.delivery) / 100,
    parcels: groups.size,
    feesEstimated: items.some((i) => !Number.isFinite(i.fee)),
    deliveryEstimated: true,
    groups: [...groups.values()].map((a) => ({
      sellerId: a[0].sellerId ? String(a[0].sellerId) : `unknown-${a[0].id}`,
      seller: a[0].sellerName || "Seller not verified",
      ids: a.map((i) => i.id),
      count: a.length,
      itemTotal: a.reduce((s, i) => s + pence(i.price), 0) / 100,
    })),
  };
}

function keepBasket(frontier, candidate) {
  const key = `${candidate.counts.join(",")}:${candidate.confirmed}`;
  const existing = frontier.get(key) ?? [];
  if (existing.some((state) => state.cost <= candidate.cost && state.valueCost <= candidate.valueCost)) return;
  const remaining = existing.filter((state) => state.cost < candidate.cost || state.valueCost < candidate.valueCost);
  remaining.push(candidate);
  remaining.sort((a, b) => a.cost - b.cost);
  // Keep the cheapest path for each fulfilment state even when the value frontier is capped.
  frontier.set(key, remaining.length > 6 ? [remaining[0], ...remaining.slice(-5)] : remaining);
}

export function planBasket(ranked, p) {
  const sellers = new Map();
  const kinds = new Map(p.wants.map((want, index) => [want.kind, index]));
  const budget = Math.floor(p.budget * 100 + 1e-7);
  const postage = pence(p.delivery);
  for (const item of ranked) {
    if (!kinds.has(item.kind) || itemCost(item) + postage > budget) continue;
    const seller = sellerKey(item);
    if (!sellers.has(seller)) sellers.set(seller, []);
    sellers.get(seller).push(item);
  }
  const frontier = new Map();
  keepBasket(frontier, { items: [], counts: p.wants.map(() => 0), confirmed: 0, cost: 0, valueCost: 0 });
  for (const listings of sellers.values()) {
    const previous = [...frontier.values()].flat();
    const buyingFromSeller = new Map();
    for (const item of listings) {
      const index = kinds.get(item.kind);
      const confirmed = Number(item.fit.status === "match");
      const cost = itemCost(item);
      function extend(states, delivery) {
        for (const state of states) {
          if (state.counts[index] >= p.wants[index].qty || state.cost + cost + delivery > budget) continue;
          const counts = [...state.counts];
          counts[index]++;
          keepBasket(buyingFromSeller, {
            items: [...state.items, item],
            counts,
            confirmed: state.confirmed + confirmed,
            cost: state.cost + cost + delivery,
            valueCost: state.valueCost + cost + delivery + item.adjustment,
          });
        }
      }
      extend([...buyingFromSeller.values()].flat(), 0);
      extend(previous, postage);
    }
    for (const states of buyingFromSeller.values()) {
      for (const state of states) keepBasket(frontier, state);
    }
  }
  const coverage = (state) => state.counts.filter(Boolean).length;
  const [best] = [...frontier.values()].flat().sort((a, b) =>
    b.items.length - a.items.length || coverage(b) - coverage(a) ||
    b.confirmed - a.confirmed || a.valueCost - b.valueCost || a.cost - b.cost,
  );
  const missing = p.wants
    .map((w, index) => ({
      kind: w.kind,
      qty: w.qty - best.counts[index],
    }))
    .filter((w) => w.qty);
  return { items: best.items, cost: calculateCosts(best.items, p), missing };
}

export function makeResult(items, p, meta = {}, comparables = items, { personal, nearMatches = false } = {}) {
  const source = { live: "observed_catalogue", feed: "authorised_feed", demo: "fictional", import: "supplied_listings" }[meta.mode];
  const ranked = rankItems(items, p, { comparables, source, personal }),
    basket = planBasket(ranked, p);
  const seen = new Set();
  const near = nearMatches && basket.missing.length ? items.flatMap((item) => {
    if (!basket.missing.some(({ kind }) => kind === item.kind) || eligible(item, p) ||
        !eligible(item, p, { preview: true }) || !(personal?.allow(item) ?? true) ||
        !isNewListing(seen, item)) return [];
    const total = calculateCosts([item], p).total;
    if (total > p.budget) return [];
    const fit = assessFit(item, p);
    const questions = (fit.checks ?? []).filter((check) => check.status === "unknown")
      .map(({ question }) => question ?? "Could you share a photo of the size label and the garment measurements?");
    if (fit.status === "unknown" && !questions.length) questions.push(fit.note);
    const missingStyle = styleRequirements(item, p).missing;
    if (missingStyle.length) questions.push(`Could you confirm these details: ${missingStyle.join(", ")}?`);
    return [{ id: item.id, title: item.title, kind: item.kind, url: item.url, fit,
      ...listingPriceNotes(item, p), questions }];
  }).sort((a, b) => a.questions.length - b.questions.length ||
    Number(b.fit.status === "near") - Number(a.fit.status === "near") ||
    a.estimatedDelivered - b.estimatedDelivered).slice(0, 3) : [];
  return {
    profile: p,
    items: ranked.slice(0, 48).map(({ adjustment, ...i }) => i),
    basket: { ...basket, items: basket.items.map(({ adjustment, ...i }) => i) },
    ...(nearMatches ? { nearMatches: near } : {}),
    meta: { checkedAt: new Date().toISOString(), ...meta },
  };
}
