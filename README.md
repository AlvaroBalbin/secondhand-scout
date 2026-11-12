# Secondhand Scout

## Paste this into an agent chat

```text
Be my Vinted UK deal scout using https://secondhand-scout-production.up.railway.app/start
```

Use a chat with HTTP or terminal access, such as Codex or Claude Code. Tell Scout what you're looking for, your sizes and your total budget including delivery. Your chat may ask to connect to Scout.

Rank secondhand clothing by your sizes, preferred brands and total budget. Scout explains each pick and groups items from the same seller so you can consider a bundle.

## Run Scout from a local checkout

```text
Be my Secondhand Scout for Vinted UK. Find the Secondhand Scout checkout in this workspace or clone https://github.com/AlvaroBalbin/secondhand-scout.git here, read AGENT-QUICKSTART.md, and run the shopping commands yourself. Ask me for any missing shopping details in one message. Show numbered picks and delivered estimates. When I say save, skip, or more like this, carry my choices forward and show what changed.
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

## Shop with saved preferences

Run `npm run scout -- shop` from the checkout, or `secondhand-scout shop` if you installed the package. Enter your brief and then use `save 1`, `skip 2 price` or `more 1 navy` on numbered picks. Use `taste` to see what Scout has learned. A skip can teach Scout about brand, colour, material, style or fit if the listing describes that feature. A named fit skip such as `skip 2 fit slim fit` also filters other listings with that cut until you ask for it explicitly. Scout flags an unspecified cut on the suggested replacement. Price and condition skips apply to the individual listing.

Scout keeps your feedback on the machine running the command in `~/.secondhand-scout/taste.json`. Set `SCOUT_TASTE_FILE` to use a different file. Feedback can change the order of picks and hide skips. It keeps your sizing and total budget in force. If a pick needs a measurement or listing detail checked, Scout may suggest a question for the seller.

Agents use the same command with `--stdin --json`. See [shopping actions for agents](AGENT-QUICKSTART.md#shopping-with-feedback) for examples and how to clear the saved data.

After a skip, use `replace 2` to look for a cheaper alternative to that basket slot. Scout checks sellers already in the basket before searching the wider catalogue. For a slim-fit shirt skip, it looks for listings that state a different cut. It shows the full basket and the price of leaving the slot open, using one estimated delivery charge per seller.

Pick numbers stay with their listings throughout the chat. Similar-item searches leave the current basket intact. In chat, you can make a slot conditional by saying “only add a fourth shirt if it can bundle.” Scout checks the sellers already in your basket for that slot and leaves it open if no eligible shirt qualifies.

Ask the agent to look deeper, recheck finalists or remember how a bought item fit. Deep searches vary the query while keeping fit and budget. Finalist checks return current listing evidence, available photo links and a seller question when needed. Fit outcomes affect the ranking of evidenced cuts and preserve explicit measurements in the brief.

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

Scout compares the listings it sees. It uses Vinted UK collar labels, where 16.5 in is listed as 41 cm, and checks the seller's wording for conflicting sizing and disclosed defects. Check photos for label size, wear and authenticity. The estimate includes listed fees when available, a fee estimate otherwise and one delivery allowance per seller. Confirm the bundle and final total at checkout.

## How Scout finds value

Scout looks for the basket that fills the most of your brief within your delivered budget. It considers all eligible candidates it checked, including items beyond the displayed shortlist, and preserves affordable paths while weighing fit, condition and style. It charges one estimated postage amount per seller and shows the estimated postage saved by bundling.

When there is enough evidence, Scout compares an item's price with fees against a median from at least four other sellers. The comparisons use the same brand, garment type, listed condition and any style or material signalled in the title. Each seller contributes one observation. The reference uses asking prices from the observed catalogue or supplied listings. A low price without enough comparable sellers still counts toward a cheaper basket.

For live search, Scout gives thin results another look through cheap and recent catalogue entries. It also checks up to two promising sellers' wardrobes and rechecks candidate listings before adding them to a basket. The search has a fixed request budget.

Codex or Claude can translate a shopper’s style into `styleByKind`. Each garment type accepts a short `search` phrase and up to four `prefer` phrases. Scout keeps the broad search and can use up to two existing follow-up searches for focused queries. It gives a modest preference to items with matching listing wording and reports the exact wording it found. Fit and total budget still apply. The agent supplies the language model, so Scout needs no separate model API key.

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
node scripts/benchmark.mjs capture examples/profile.json work/deep-snapshot.json --deep
node scripts/benchmark.mjs compare work/search-snapshot.json work/deep-snapshot.json
node scripts/benchmark.mjs replay work/search-snapshot.json
```

For repeated comparisons, run `node scripts/benchmark.mjs suite work/suite.json` with a version 1 object containing a `source` description and `cases`. Each case has `standard` and `expanded` snapshots for the same brief. The report counts coverage changes and price changes at equal coverage. Record whether cases come from separate live captures or variations of a shared inventory.

Create `work/` first for a capture. The replay compares catalogue-only and wardrobe-expanded baskets over the same observed listings and price references. It reports filled requests, fit evidence, parcel count, cost at equal coverage and ranking time. Add `suitableIds` to a local snapshot to compare picks with your own suitability labels. This measures the effect of wardrobe additions in that capture. Discovery time covers the recorded search. Keep real snapshots local.

Run `node scripts/benchmark.mjs audit work/labelled-corpus.json` for a text-evidence audit. A version 1 corpus has `condition` rows with `id`, `title`, `description` and a boolean `defective` label, `fit` rows with `item`, `profile` and an expected fit status, and `baskets` containing replay snapshots. Optional `style` rows have `item`, `term` and a boolean `expected` label. Keep the labels fixed across versions. The audit measures what listings disclose in text. Garment photos and actual fit need separate checks.

## Connect an authorised feed

Scout can read from a local index synced from an authorised Vinted UK feed or export. The input is a versioned JSON snapshot followed by timestamped deltas. Stable listing IDs and seller IDs allow price history, availability updates and bundle checks.

```sh
node scripts/feed.mjs sync work/feed-state.json /path/to/authorised-snapshot.json
node scripts/feed.mjs sync work/feed-state.json /path/to/authorised-delta.json
```

Set `SCOUT_FEED_FILE` to the state file when running the CLI, API or MCP server. Scout uses the feed for searches and requires it to be recent. The default freshness limit is 60 minutes, configurable with `SCOUT_FEED_MAX_AGE_MINUTES`. To sync over HTTPS, set `SCOUT_FEED_URL` and optionally `SCOUT_FEED_TOKEN`, then omit the batch filename. The sync passes the last cursor as `cursor` and writes the new state only after validation. See the [feed contract](examples/feed-snapshot.json).

Run `node scripts/feed.mjs watch work/feed-state.json` to poll the authorised HTTPS feed at its permitted interval. Set `SCOUT_FEED_POLL_SECONDS` to control the interval. Updates use `mode: "delta"` and may supply `removedIds`. Keep timestamps increasing and treat removals as unavailable. Price changes are tracked per listing, and fresh listings and price drops get room in the shortlist.

## Hosted search API

Run `node scripts/dev.mjs --hosted` or build the included Dockerfile. Set `SCOUT_FEED_FILE` to a synced state file and expose the service over HTTPS. `PORT` defaults to 4317. Set `SCOUT_SEARCH_TOKEN` for bearer authentication when sharing privately. `GET /v1/health` checks the process and `POST /v1/search` accepts the same brief as the local search API, with optional `"depth":"deep"`. Hosted search is read-only, returns the feed observation time, and fails when the feed is stale or missing.

Once you have a hosted URL, paste this into a terminal-capable agent chat.

```text
Be my Secondhand Scout. Ask what I want, my sizes and my delivered budget, then POST {"profile":{...}} to MY_SCOUT_URL/v1/search. Show the listing links, fit notes and delivered basket estimate. Use depth "deep" if I ask you to look further.
```

Live search is experimental. It uses the catalogue parser from [googlarz/vinted-mcp-cli](https://github.com/googlarz/vinted-mcp-cli) and stops if Vinted denies access. Use the live modes only where permitted by the [Vinted UK terms](https://www.vinted.co.uk/terms-and-conditions). The local rank command works with your own listing data without marketplace access.

MIT licensed. The reused client modules retain their [upstream licence](vendor/vinted-client/LICENSE).
