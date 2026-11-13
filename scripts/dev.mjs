import { createServer } from "node:http";
import { api } from "../src/app.js";

const hosted = process.argv.includes("--hosted");
const host = process.env.SCOUT_HOST ?? (hosted ? "0.0.0.0" : "127.0.0.1");
const port = Number(process.env.PORT ?? 4317);
if (hosted && !process.env.SCOUT_FEED_FILE && process.env.SCOUT_HOSTED_LIVE !== "1") {
  console.error("Hosted search requires SCOUT_FEED_FILE or SCOUT_HOSTED_LIVE=1.");
  process.exit(1);
}
const reply = (outgoing, status, error) => {
  outgoing.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  outgoing.end(JSON.stringify({ error }));
};
const quickstart = `Secondhand Scout for Vinted UK

Ask the shopper for any missing items, quantities, sizes and total budget including delivery. Ask together in one message. Then call Scout yourself using your HTTP or terminal tool. No installation or account is required.

POST /v1/search on the same HTTPS origin as this guide. Send Content-Type: application/json and allow up to 120 seconds.
Example body: {"profile":{"wants":{"jumpers":1},"brands":"Hackett","sizes":"L","department":"men","budget":50}}

Use the shopper's actual brief. Supported keys in wants are shirts, jumpers, gilets, jackets, trousers and shoes. Supply sizes as a comma-separated string, budget in GBP and collar in centimetres for shirts if given. Include department and brands when provided. Put garment measurements in fitByKind, for example {"trousers":{"waistIn":34,"inseamIn":30},"jackets":{"pitToPitCm":[56,58]}}. Put style filters in styleByKind, for example {"shoes":{"search":"suede loafers","require":["suede","loafers"]}}.

Use the basket and candidates from the response to show numbered Vinted links, fit evidence and estimated delivered prices. Put each item's disclosures about alterations or damage next to its price. If nearMatches are returned, show them separately with the measurement difference or the seller question. Mention any missing items or unverified fit. If the API is temporarily busy, retry once after 15 seconds. Report other errors rather than inventing listings.
`;
const server = createServer(async (incoming, outgoing) => {
  try {
    const url = new URL(incoming.url, `http://${host}:${server.address().port}`);
    if (hosted) {
      if (url.pathname === "/start") {
        if (incoming.method !== "GET" && incoming.method !== "HEAD")
          return reply(outgoing, 405, "Use GET.");
        outgoing.writeHead(200, {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        });
        return outgoing.end(incoming.method === "GET" ? quickstart : undefined);
      }
      if (!["/v1/search", "/v1/health"].includes(url.pathname))
        return reply(outgoing, 404, "Not found.");
      const token = process.env.SCOUT_SEARCH_TOKEN;
      if (url.pathname === "/v1/search" && token && incoming.headers.authorization !== `Bearer ${token}`)
        return reply(outgoing, 401, "Search token required.");
      url.pathname = url.pathname === "/v1/search" ? "/api/search" : "/api/health";
    }
    const chunks = [];
    let length = 0;
    for await (const chunk of incoming) {
      length += chunk.length;
      if (length > 32_768) {
        return reply(outgoing, 413, "Request exceeds 32 KB.");
      }
      chunks.push(chunk);
    }
    const request = new Request(url, {
      method: incoming.method,
      headers: incoming.headers,
      ...(incoming.method === "POST" ? { body: Buffer.concat(chunks) } : {}),
    });
    const response = await api(request);
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  } catch {
    reply(outgoing, 500, "Unable to process request.");
  }
});
server.listen(port, host, () =>
  console.log(`Secondhand Scout API listening at http://${host}:${server.address().port}`),
);
