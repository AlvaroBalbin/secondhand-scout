# Secondhand Scout

Rank secondhand clothing by your sizes, preferred brands and total budget. Scout explains each pick and groups items from the same seller so you can consider a bundle.

## Try it

Requires Node.js 22 or newer. The CLI and API have no third-party runtime dependencies.

```sh
git clone https://github.com/AlvaroBalbin/secondhand-scout.git
cd secondhand-scout
npm run scout -- demo
```

Edit [examples/profile.json](examples/profile.json) with the clothes you want, your sizes, brands and budget in GBP. Then run one of these commands.

```sh
# Rank listings you collected yourself
npm run scout -- rank examples/profile.json examples/listings.json

# Try live UK Vinted search
npm run scout -- search examples/profile.json

# Check specific listing links
npm run scout -- import examples/profile.json https://www.vinted.co.uk/items/ITEM_ID
```

Add `--json` for structured output. The sample listings are fictional.

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
