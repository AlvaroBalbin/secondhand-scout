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

Show the numbered picks from the basket using the API's pick numbers. For each, show the Vinted link, estimated delivered price, fit evidence and any disclosures about alterations or damage together. Individual estimates include their own postage. Use basket.cost.total for the combined total with bundle postage. Show nearMatches separately with the measurement difference or seller question.

Keep the latest session value in this chat. For follow-ups, POST /v1/follow-up on this same origin. For "keep #2, swap #3 for cheaper only if it bundles", send {"session":"SESSION_FROM_SEARCH","keep":[2],"swap":{"number":3,"bundleOnly":true}}. For a keep-only reply, omit swap. Only send numbers the shopper chose. Use the returned session for the next reply and preserve its pick numbers. Show the previous and new basket.cost.total. If outcome is no_replacement, explain that the original is still in the basket and show leaveOpenTotal as the option if they drop it. If the API is temporarily busy, wait 16 seconds and retry once. Report other errors rather than inventing listings.
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
      if (!["/v1/search", "/v1/health", "/v1/follow-up"].includes(url.pathname))
        return reply(outgoing, 404, "Not found.");
      const token = process.env.SCOUT_SEARCH_TOKEN;
      if (url.pathname !== "/v1/health" && token && incoming.headers.authorization !== `Bearer ${token}`)
        return reply(outgoing, 401, "Search token required.");
      url.pathname = url.pathname.replace("/v1/", "/api/");
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
    const response = await api(request, {}, hosted);
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  } catch {
    reply(outgoing, 500, "Unable to process request.");
  }
});
server.listen(port, host, () =>
  console.log(`Secondhand Scout API listening at http://${host}:${server.address().port}`),
);
