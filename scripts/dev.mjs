import { createServer } from "node:http";
import { api } from "../src/app.js";

const host = "127.0.0.1";
const port = Number(process.env.PORT ?? 4317);
const server = createServer(async (incoming, outgoing) => {
  try {
    const chunks = [];
    let length = 0;
    for await (const chunk of incoming) {
      length += chunk.length;
      if (length > 32_768) {
        outgoing.writeHead(413, { "Content-Type": "application/json" });
        outgoing.end(JSON.stringify({ error: "Request exceeds 32 KB." }));
        return;
      }
      chunks.push(chunk);
    }
    const url = new URL(incoming.url, `http://${host}:${port}`);
    const request = new Request(url, {
      method: incoming.method,
      headers: incoming.headers,
      ...(incoming.method === "POST" ? { body: Buffer.concat(chunks) } : {}),
    });
    const response = await api(request);
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  } catch {
    outgoing.writeHead(500, { "Content-Type": "application/json" });
    outgoing.end(JSON.stringify({ error: "Unable to process request." }));
  }
});
server.listen(port, host, () =>
  console.log(`Secondhand Scout API listening at http://${host}:${port}`),
);
