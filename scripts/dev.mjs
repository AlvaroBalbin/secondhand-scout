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
const server = createServer(async (incoming, outgoing) => {
  try {
    const url = new URL(incoming.url, `http://${host}:${server.address().port}`);
    if (hosted) {
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
