# TrueUp for JavaScript and TypeScript

The official client for the [TrueUp API](https://trueup-cloud.merchantprotocol.workers.dev/docs). Send TrueUp two ledgers (a supplier statement and your receiving log, your books and the bank feed, invoices and payments) and it pairs every row, then tells you what's only on one side, what was counted twice and where the numbers disagree.

Works in Node 18+, Deno, Bun and Cloudflare Workers. No dependencies.

## Install

```bash
npm install trueup
```

## Quickstart

Create an API key in the TrueUp dashboard (**API keys**), then:

```bash
export TRUEUP_API_KEY=tu_live_...
```

```ts
import { TrueUp } from "trueup";

const trueup = new TrueUp(); // reads TRUEUP_API_KEY

const result = await trueup.reconcile({
  left: { path: "statement.csv" },   // the side that bills or claims
  right: { path: "receiving.csv" },  // the other side
});

console.log(result.headline);
// 7 of 8 rows of statement.csv paired with receiving.csv; 1 only in statement.csv, ...
for (const f of result.findings) {
  console.log(f.kind, f.subject, f.detail, f.amount);
}
// qty_mismatch statement.csv:row 5 Qty 24 vs qty_received 20; ... 99.6
// phantom statement.csv:row 6 no match on the other side 43.2
```

## Reconcile

A table is a file on disk, file contents, or rows:

```ts
await trueup.reconcile({ left: { path: "books.csv" }, right: { path: "bank.csv" } });
await trueup.reconcile({ left: { name: "books.csv", content: csvText }, right: { name: "bank.csv", content: bytes } });
await trueup.reconcile({
  left: { name: "invoices", rows: [{ "Invoice #": "INV-10101", Date: "2026-06-09", Total: "$2,999.31" }] },
  right: { name: "payments", rows: [{ Received: "2026-07-01", From: "ACME CONSTR", Amount: "2999.31" }] },
});
```

CSV, TSV, JSON and JSON Lines are read, and date and number formats are detected. Nothing about the columns is configured.

Not sure which file is which? Send them all and TrueUp picks the pair and the sides:

```ts
await trueup.reconcileFiles([{ path: "a.csv" }, { path: "b.csv" }]);
```

**Reuse what was learned.** Every result carries `details.weights`. Pass them back to reconcile next month's files the same way, without learning again:

```ts
const march = await trueup.reconcile({ left: { path: "march-statement.csv" }, right: { path: "march-receiving.csv" } });
const april = await trueup.reconcile({
  left: { path: "april-statement.csv" },
  right: { path: "april-receiving.csv" },
  weights: march.details.weights,
});
```

**Answer the questions.** Findings with `status: "unsure"` need a person. Send the decisions back:

```ts
await trueup.reconcile({
  left: { path: "statement.csv" },
  right: { path: "receiving.csv" },
  answers: { same: [["statement.csv:row 12", "receiving.csv:row 11"]], different: [["statement.csv:row 3", "receiving.csv:row 9"]] },
});
```

Each call to `reconcile` or `reconcileFiles` counts as one analysis on your plan.

## Findings

| `kind` | Meaning |
|---|---|
| `phantom` | Only on the left: billed or recorded, never matched |
| `unbilled` | Only on the right: received or paid, never billed |
| `duplicate`, `received_duplicate` | A copy of a row that's already paired |
| `qty_mismatch`, `price_change`, `amount_mismatch` | Paired rows whose numbers disagree |
| `unsure_pair` | A likely pair a person should confirm |

## Account and usage

```ts
await trueup.account(); // { team, plan, key }
await trueup.usage();   // { period, resets_at, metrics: [{ metric, used, included, remaining, ... }] }
await trueup.plans();
```

## Errors

Every error is a `TrueUpError` with `status`, `code` (the API's error code) and `message`:

| Class | When |
|---|---|
| `AuthenticationError` | 401: missing, unknown or revoked key |
| `InvalidRequestError` | 400, 413, 415, 422: the request or the files need fixing (`unsupported_file`, `not_reconcilable`, ...) |
| `RateLimitError` | 429 `rate_limited`: retried automatically; `retryAfter` seconds |
| `QuotaExceededError` | 429 `quota_exceeded`: the plan's monthly allowance is used up |
| `ServerError` | 5xx: retried automatically |
| `ConnectionError` | the API couldn't be reached |

```ts
import { QuotaExceededError } from "trueup";
try {
  await trueup.reconcile({ left: { path: "a.csv" }, right: { path: "b.csv" } });
} catch (e) {
  if (e instanceof QuotaExceededError) console.log("Upgrade the plan:", e.message);
  else throw e;
}
```

## Configuration

```ts
new TrueUp({
  apiKey: "tu_live_...",   // default: TRUEUP_API_KEY
  baseUrl: "https://...",  // default: TRUEUP_BASE_URL, then the hosted API
  timeoutMs: 300_000,      // per request
  maxRetries: 2,           // rate limits, 5xx and dropped connections
});
```

## Development

The tests run in Docker against the live API:

```bash
export TRUEUP_API_KEY=tu_live_...   # a key for a test team (each run uses 2 analyses)
just test                            # or: docker compose run --rm test
```

## License

MIT
