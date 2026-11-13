import { InputError } from "./engine.js";

const searchExample = { profile: { wants: { shirts: 2 }, brands: "Ralph Lauren",
  department: "men", collar: 41, budget: 60, styleByKind: { shirts: { avoid: ["slim fit"] } } } };

export const hostedContract = {
  search: { method: "POST", path: "/v1/search", example: searchExample,
    optional: { depth: "deep", resume: "Use your private resume code to apply past fit feedback to a new brief." },
    fields: { wants: "Counts keyed by shirts, jumpers, gilets, jackets, trousers, shoes (up to three types)",
      brands: "Comma-separated brand names", sizes: "Comma-separated label sizes",
      collar: "Shirt collar in cm. Vinted UK maps 16.5 inches to its 41 cm category. Keep seller-stated 42 cm out.",
      budget: "Total GBP including fees and estimated delivery",
      fitByKind: { trousers: { waistIn: 34, inseamIn: 30 }, jackets: { pitToPitCm: [56, 58] } },
      styleByKind: { shoes: { search: "suede loafers", require: ["suede", "loafers"], prefer: [], avoid: [] } } } },
  followUp: { method: "POST", path: "/v1/follow-up", examples: [
    { session: "SESSION", keep: [2], swap: { number: 3, bundleOnly: true } },
    { session: "SESSION", verify: [1, 2] },
    { session: "SESSION", explore: true },
    { session: "SESSION", fit: { number: 2, outcome: "fits", area: "chest" } },
    { session: "SESSION", remember: true },
    { resume: "PRIVATE_RESUME_CODE" },
  ] },
};

export function hostedProfile(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return input;
  const { styleByKind, ...profile } = input;
  if (styleByKind == null || typeof styleByKind !== "object" || Array.isArray(styleByKind)) return input;
  return { ...profile, styleByKind: Object.fromEntries(Object.entries(styleByKind).map(([kind, style]) => {
    if (!style || typeof style !== "object" || Array.isArray(style)) return [kind, style];
    const { exclude, mustHave, keywords, ...rest } = style;
    return [kind, { ...rest,
      ...(exclude !== undefined && rest.avoid === undefined ? { avoid: exclude } : {}),
      ...(mustHave !== undefined && rest.require === undefined ? { require: mustHave } : {}),
      ...(keywords !== undefined && rest.search === undefined ? { search: keywords } : {}),
    }];
  })) };
}

export function requestCorrection(error) {
  if (!(error instanceof InputError)) return {};
  return { schema: "/v1/schema", ...(error.message.includes("style") ? {
    hint: "Use styleByKind.<garment> with search, require, prefer and avoid.",
  } : {}) };
}
