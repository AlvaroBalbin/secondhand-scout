import { api } from "../src/app.js";

export async function runScout(mode, body, rankingOptions) {
  const response = await api(
    new Request(new URL(mode, "http://localhost/api/"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }), rankingOptions,
  );
  return { ok: response.ok, result: await response.json() };
}
