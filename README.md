# Secondhand Scout

Rank secondhand clothing by your sizes, preferred brands and total budget. Scout explains each pick and groups items from the same seller so you can consider a bundle.

## Paste this into an agent chat

```text
Use Secondhand Scout for Vinted UK. Ask me in one message for items and quantities, sizes and total budget including delivery. Use Scout if connected. Otherwise clone https://github.com/AlvaroBalbin/secondhand-scout.git and run `node scripts/scout.mjs search --stdin --json` with a JSON request shaped like `{"profile":{"wants":{"jumpers":1},"sizes":"L","budget":50}}`, using my answers. Show listing links and estimated delivered prices. If live search is blocked, give me prefilled Vinted UK search links.
```

Use a chat that can run terminal commands, such as Codex or Claude Code, or one that already has Secondhand Scout connected. For a first search, the agent can run Scout directly from the repository with Git and Node.js 22 or newer. If live access is blocked, the agent can give you prefilled Vinted searches to open. [Agent quickstart](AGENT-QUICKSTART.md)

## Try it

Requires Git and Node.js 22 or newer. Run these commands in your terminal.

```sh
git clone https://github.com/AlvaroBalbin/secondhand-scout.git
cd secondhand-scout
npm run scout
```

Enter what you want, such as `3 shirts, 2 jumpers, 1 gilet`, then answer the size and budget questions. Press Enter to skip optional preferences. Scout prints the shortlist with fit notes, listing links and estimated costs by seller.

To try the same questions with fictional listings, run `npm run scout -- wizard --demo`. For a quick sample without prompts, run `npm run scout -- demo`.

## Use with Codex or Claude Code

Connect Scout permanently if you want it available across projects.

Clone the repo and run `npm ci` inside it. Then run the command for your agent in PowerShell or a macOS/Linux shell.

```sh
# Codex CLI and the Codex app
codex mcp add secondhand-scout -- node "$PWD/scripts/mcp.mjs"

# Claude Code
claude mcp add --scope user --transport stdio secondhand-scout -- node "$PWD/scripts/mcp.mjs"
```

Open a new session and ask:

> Use Secondhand Scout to find three Ralph Lauren or Hackett shirts with a 41 cm collar, two size L jumpers and one size L gilet on Vinted UK. My total budget is £150 with delivery. Look for same-seller bundles.

For a quick connection check, ask it to use `demo_deals` with your preferences. The server runs locally over standard input and output. It offers four read-only tools for live search, checking item links, ranking supplied listings and trying fictional examples. Setup requires no Vinted credentials or separate model API key. [Codex MCP setup](https://developers.openai.com/codex/mcp) · [Claude Code MCP setup](https://code.claude.com/docs/en/mcp)

If a broad live search hits the Codex tool timeout, set `tool_timeout_sec = 120` in the existing `[mcp_servers.secondhand-scout]` section of your Codex configuration. [Codex MCP configuration](https://developers.openai.com/codex/mcp)

## CLI with saved briefs

For scripts and repeat searches, save your preferences using the [example brief](examples/profile.json) as a template.

```sh
# Rank listings you collected yourself
npm run scout -- rank examples/profile.json examples/listings.json

# Try live UK Vinted search
npm run scout -- search examples/profile.json

# Check specific listing links
npm run scout -- import examples/profile.json https://www.vinted.co.uk/items/ITEM_ID
```

Add `--json` for structured output. Use `npm run --silent scout -- … --json` or call `node scripts/scout.mjs` directly if you need stdout to contain only JSON.

With `--stdin`, send the same request body as the corresponding API endpoint below. With `--json`, this mode prints the profile, basket and search metadata.

## Local API

Run `npm start` and call `http://127.0.0.1:4317`. Set the `PORT` environment variable to change the port.

| Method and path | Request body |
| --- | --- |
| `GET /api/health` | None |
| `POST /api/demo` | `{ "profile": { … } }` |
| `POST /api/search` | `{ "profile": { … } }` |
| `POST /api/import` | `{ "profile": { … }, "links": ["https://www.vinted.co.uk/items/…"] }` |
| `POST /api/rank` | `{ "profile": { … }, "listings": [ … ] }` |

```js
// Run with Node.js from the repository after starting the API.
import { readFile } from 'node:fs/promises';
const profile = JSON.parse(await readFile('examples/profile.json', 'utf8'));
const response = await fetch('http://127.0.0.1:4317/api/demo', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ profile }),
});
console.log(await response.json());
```

The response includes candidate items, fit notes, the suggested basket, seller groups, estimated costs and any missing quantities. See the [sample brief](examples/profile.json) and [listing input](examples/listings.json) for the field format. Supported clothing types are `shirts`, `jumpers`, `gilets`, `jackets`, `trousers` and `shoes`. Enter garment sizes separated by commas. For shirts, you can also enter a collar measurement in centimetres. `delivery` is the postage allowance per seller.

Scout compares the listings it sees. It checks sizing and defects described in listing text. Check photos for label size, wear and authenticity. The estimate includes listed fees when available, a fee estimate otherwise and one delivery allowance per seller. Confirm the bundle and final total at checkout.

Live search is experimental. It uses the catalogue parser from [googlarz/vinted-mcp-cli](https://github.com/googlarz/vinted-mcp-cli) and stops if Vinted denies access. Use the live modes only where permitted by the [Vinted UK terms](https://www.vinted.co.uk/terms-and-conditions). The local rank command works with your own listing data without marketplace access.

MIT licensed. The reused client modules retain their [upstream licence](vendor/vinted-client/LICENSE).
