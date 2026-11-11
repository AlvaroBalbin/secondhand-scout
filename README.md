# Secondhand Scout

Rank secondhand clothing by your sizes, preferred brands and total budget. Scout explains each pick and groups items from the same seller so you can consider a bundle.

## Paste this into an agent chat

```text
Find me live Vinted UK deals with Secondhand Scout. Ask me in one message for items, quantities, fit per item type and budget including delivery. Clone https://github.com/AlvaroBalbin/secondhand-scout.git in this chat’s workspace and run `node scripts/scout.mjs search --stdin --json` from the clone. Pipe in my answers like `{"profile":{"wants":{"jumpers":1},"fitByKind":{"jumpers":{"sizes":["L"]}},"budget":50}}`. Use the public repo and Vinted. If needed, request approval for the clone or search. Show links and estimated delivered total. If blocked, say why and give prefilled Vinted searches.
```

Use a Codex or Claude Code chat with terminal access and Git and Node.js 22 or newer available. The agent handles the clone and search without an npm install or MCP setup. Approve the clone or search if your client asks. If live access is blocked, the agent can give you prefilled Vinted searches to open. [Agent quickstart](AGENT-QUICKSTART.md)

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

## How Scout finds value

Scout looks for the basket that fills the most of your brief within your delivered budget. It considers all eligible candidates it checked, including items beyond the displayed shortlist, and preserves affordable paths while weighing fit, condition and style. It charges one estimated postage amount per seller and shows the estimated postage saved by bundling.

When there is enough evidence, Scout compares an item's price with fees against a median from at least four other sellers. The comparisons use the same brand, garment type, listed condition and any style or material signalled in the title. Each seller contributes one observation. The reference uses asking prices from the observed catalogue or supplied listings. A low price without enough comparable sellers still counts toward a cheaper basket.

For live search, Scout gives thin results another look through cheap and recent catalogue entries. It also checks up to two promising sellers' wardrobes and rechecks candidate listings before adding them to a basket. The search has a fixed request budget.

## Fit by garment

The agent, CLI and API accept separate requirements in the same brief. Shared `sizes` and shirt `collar` still work. With the guided CLI you can enter `jumpers=L | trousers=W34L32` in the size prompt and give the shirt collar separately.

```json
{
  "wants": { "shirts": 1, "jumpers": 1, "trousers": 1 },
  "fitByKind": {
    "shirts": { "collarCm": 41 },
    "jumpers": { "sizes": ["L"], "pitToPitCm": [53, 57] },
    "trousers": { "waistIn": 34, "inseamIn": [30, 32] }
  },
  "budget": 100
}
```

Ask for measurements when they're important to fit. Scout recognises declared measurements with units, structured measurements from a feed, and explicit W/L labels on trousers. A missing measurement stays unverified. Default strict fit requires evidence for each requested fit field.

## Replay a search

```sh
node scripts/benchmark.mjs replay examples/benchmark.json
node scripts/benchmark.mjs capture examples/profile.json work/search-snapshot.json
node scripts/benchmark.mjs replay work/search-snapshot.json
```

Create `work/` first for a capture. The replay compares catalogue-only and wardrobe-expanded baskets over the same observed listings and price references. It reports filled requests, fit evidence, parcel count, cost at equal coverage and ranking time. Add `suitableIds` to a local snapshot to compare picks with your own suitability labels. This measures the effect of wardrobe additions in that capture. Discovery time covers the recorded search. Keep real snapshots local.

## Connect an authorised feed

Scout can read from a local index synced from an authorised Vinted UK feed or export. The input is a versioned JSON snapshot followed by timestamped deltas. Stable listing IDs and seller IDs allow price history, availability updates and bundle checks.

```sh
node scripts/feed.mjs sync work/feed-state.json /path/to/authorised-snapshot.json
node scripts/feed.mjs sync work/feed-state.json /path/to/authorised-delta.json
```

Set `SCOUT_FEED_FILE` to the state file when running the CLI, API or MCP server. Scout uses the feed for searches and requires it to be recent. The default freshness limit is 60 minutes, configurable with `SCOUT_FEED_MAX_AGE_MINUTES`. To sync over HTTPS, set `SCOUT_FEED_URL` and optionally `SCOUT_FEED_TOKEN`, then omit the batch filename. The sync passes the last cursor as `cursor` and writes the new state only after validation. See the [feed contract](examples/feed-snapshot.json).

Run `node scripts/feed.mjs watch work/feed-state.json` to poll the authorised HTTPS feed at its permitted interval. Set `SCOUT_FEED_POLL_SECONDS` to control the interval. Updates use `mode: "delta"` and may supply `removedIds`. Keep timestamps increasing and treat removals as unavailable. Price changes are tracked per listing, and fresh listings and price drops get room in the shortlist.

Live search is experimental. It uses the catalogue parser from [googlarz/vinted-mcp-cli](https://github.com/googlarz/vinted-mcp-cli) and stops if Vinted denies access. Use the live modes only where permitted by the [Vinted UK terms](https://www.vinted.co.uk/terms-and-conditions). The local rank command works with your own listing data without marketplace access.

MIT licensed. The reused client modules retain their [upstream licence](vendor/vinted-client/LICENSE).
