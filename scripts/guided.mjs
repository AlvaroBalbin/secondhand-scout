import { createInterface } from "node:readline";
import { KINDS, validateProfile } from "../src/engine.js";

const aliases = new Map(Object.entries(KINDS).flatMap(([kind, label]) => [
  [kind, kind], [label, kind],
]));
for (const [label, kind] of Object.entries({
  sweater: "jumpers", cardigan: "jumpers", coat: "jackets", blazer: "jackets",
  vest: "gilets", gillet: "gilets", jeans: "trousers", chinos: "trousers",
  boots: "shoes", trainers: "shoes", shoe: "shoes", trouser: "trousers",
})) {
  aliases.set(label, kind);
  aliases.set(`${label}s`, kind);
}

function clothingList(answer) {
  const wants = {};
  for (const part of answer.toLowerCase().split(/\s*(?:,|\band\b)\s*/)) {
    const match = part.trim().match(/^(?:(\d+)\s+)?([a-z]+)$/);
    const kind = match && aliases.get(match[2]);
    if (!kind) return;
    const qty = Number(match[1] ?? 1);
    if (qty < 1) return;
    wants[kind] = (wants[kind] ?? 0) + qty;
  }
  const counts = Object.values(wants);
  if (counts.length <= 3 && counts.every((qty) => qty <= 8) &&
      counts.reduce((total, qty) => total + qty, 0) <= 12) return wants;
}

function list(answer, limit, length) {
  const values = answer.split(",").map((value) => value.trim()).filter(Boolean);
  if (values.length <= limit && values.every((value) => value.length <= length))
    return values;
}

function fitAnswer(answer, wants, collar) {
  if (!answer.includes("=")) {
    const sizes = list(answer, 4, 12);
    if (sizes?.length) return { sizes: sizes.join(", ") };
    return;
  }
  const fitByKind = {};
  for (const part of answer.split("|")) {
    const [name, values, extra] = part.split("=");
    const kind = aliases.get(name.trim().toLowerCase());
    if (!kind || !wants[kind] || !values?.trim() || extra !== undefined || fitByKind[kind]) return;
    const waist = kind === "trousers" && values.trim().match(/^w(\d{2})(?:\s*l(\d{2}))?$/i);
    const sizes = list(values, 4, 12);
    if (!sizes?.length) return;
    fitByKind[kind] = waist ? { waistIn: Number(waist[1]), ...(waist[2] ? { inseamIn: Number(waist[2]) } : {}) } :
      { sizes: sizes.join(", ") };
  }
  try {
    validateProfile({ wants, collar, fitByKind, budget: 50 });
    return { fitByKind };
  } catch {
    return;
  }
}

export async function guidedProfile(input = process.stdin, output = process.stderr) {
  const terminal = Boolean(input.isTTY && output.isTTY);
  const reader = createInterface({ input, output, terminal, crlfDelay: Infinity });
  reader.on("SIGINT", () => reader.close());
  const lines = reader[Symbol.asyncIterator]();
  async function ask(prompt, parse, error) {
    for (;;) {
      if (terminal) {
        reader.setPrompt(prompt);
        reader.prompt();
      } else {
        output.write(prompt + "\n");
      }
      const { done, value } = await lines.next();
      if (done) throw new Error("Shopping brief cancelled.");
      const answer = parse(value.trim());
      if (answer !== undefined) return answer;
      output.write(error + "\n");
    }
  }
  try {
    const wants = await ask(
      "What clothes do you want? (e.g. 3 shirts, 2 jumpers, 1 gilet) ",
      clothingList,
      "Use shirts, jumpers, gilets, jackets, trousers or shoes. Up to 3 types, 8 of each and 12 items total.",
    );
    const collar = wants.shirts ? await ask(
      "Shirt collar size in cm? (e.g. 41, Enter to skip) ",
      (answer) => {
        if (!answer) return null;
        const cm = Number(answer.replace(/\s*cm$/i, ""));
        if (cm >= 30 && cm <= 60) return cm;
      },
      "Enter a collar size in cm between 30 and 60, or press Enter to skip.",
    ) : null;
    const collarOnly = collar !== null && Object.keys(wants).length === 1;
    const fit = collarOnly ? {} : await ask(
      "What sizes fit you? (e.g. M, L or jumpers=L | trousers=W34) ",
      (answer) => fitAnswer(answer, wants, collar),
      "Enter up to four shared sizes or sizes for each item type. A shirt collar can stand on its own.",
    );
    const budget = await ask(
      "Total budget in GBP, including fees and delivery? (e.g. 150) ",
      (answer) => {
        const pounds = answer.replace(/^£\s*/, "");
        if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(pounds)) return;
        const amount = Number(pounds.replaceAll(",", ""));
        if (amount >= 10 && amount <= 5000) return amount;
      },
      "Enter a budget from £10 to £5,000.",
    );
    const department = await ask(
      "Which department? (men, women, or Enter for any) ",
      (answer) => {
        const value = answer.toLowerCase() || "any";
        if (["men", "women", "any"].includes(value)) return value;
      },
      "Enter men, women or any.",
    );
    const brands = await ask(
      "Any preferred brands? (e.g. Ralph Lauren, Hackett, Enter for any) ",
      (answer) => list(answer, 3, 45)?.join(", "),
      "Enter up to three brands separated by commas.",
    );
    return { wants, ...fit, budget, collar, department, brands };
  } finally {
    reader.close();
  }
}
