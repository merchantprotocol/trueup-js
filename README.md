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

## Match

Two lists that describe the same things in different words (two catalogs, a supplier's price book and your invoice, two vendor lists): every record on the left is paired with its counterpart on the right, or reported as having none. Nothing is configured; the columns can have different names.

```ts
const result = await trueup.match({ left: { path: "invoice.csv" }, right: { path: "catalog.csv" } });
console.log(result.headline);
// 4 of 5 records in invoice.csv matched to catalog.csv (0 unsure); 1 have no counterpart.
for (const f of result.findings) console.log(f.kind, f.subject, f.confidence, f.detail);
// match 4 ~ 5 0.965 4 · cheese puffs jumbo 8oz · 3.30 · 10  ↔  C-105 · Cheese Puffs Jumbo 8 oz · 3.25
// only_left 5 null 5 · beef jerky teriyaki 2.5oz · 5.75 · 6
```

`kind` is `match`, `unsure_match` (a person should check), `only_left` or `only_right`. `details.pairs` lists `[left id, right id, confidence]`. Like `reconcile`, it takes files, contents or rows; `matchFiles([...])` picks the pair; `matchStored({ leftFileId, rightFileId }, { model })` works on stored files; and `details.weights` can be passed back as `weights` to match next month's lists the same way. One analysis per call.

## Audit

Find what doesn't add up. Send text documents with labeled amounts (invoices, statements, schedules; about 4 or more of a kind) and TrueUp learns the arithmetic each kind obeys from the documents themselves, then flags the ones that break it. Send one table and it checks its rows the same way (qty × unit price = amount), and flags repeated rows.

```ts
const result = await trueup.audit([{ path: "inv-1041.txt" }, { path: "inv-1042.txt" }, /* … */ { path: "inv-1046.txt" }]);
console.log(result.headline);
// 1 of 6 documents don't add up; 0 more to review (5 laws learned).
for (const f of result.findings) console.log(f.subject, f.amount, f.detail);
// inv-1045.txt 200 subtotal + tax amount = total: 4,837.84 vs 5,037.84

// Next month, even one invoice at a time, against the same laws:
await trueup.audit([{ path: "inv-1050.txt" }], { weights: result.details.weights });
```

`auditStored(fileIds, { model })` audits stored files. One analysis per call.

## Estimate

Price a new job from your past estimates. Send a domain file for the trade (a `.tu` file naming the facts to read, what costs scale with, and the cost categories), at least 3 past estimates in any format (CSV, TSV, Markdown, JSON, or text proposals), and one request describing the new job in plain words:

```ts
const result = await trueup.estimate([
  { path: "barndo.tu" },
  { path: "01_anderson.csv" }, { path: "02_brooks.csv" }, { path: "03_carter.md" }, /* … */
  { path: "job_a.txt" },
]);
console.log(result.headline);
// job_a.txt: $292,267 (80% range $248,742 – $335,792) from 10 past estimates.
for (const f of result.findings.filter((f) => f.kind === "priced_line")) console.log(f.subject, f.amount, f.detail);

// The next job, with what was learned (no need to send the history again):
await trueup.estimate([{ path: "job_b.txt" }], { weights: result.details.weights });
```

`estimateStored(fileIds, { model })` prices from stored files. One analysis per call.

## Stored files, runs and saved models

Files uploaded to your team stay there (you'll also see them in the dashboard). Runs on stored files are kept, and what a run learned can be saved as a model:

```ts
const [statement, receiving] = await trueup.files.upload({ path: "statement.csv" }, { path: "receiving.csv" });
statement.rows;    // 8
statement.roles;   // { "Inv Date": "date", Qty: "number", ... }

const result = await trueup.reconcileStored({ leftFileId: statement.id, rightFileId: receiving.id });
const modelId = await trueup.models.create({ runId: result.run_id, name: "Acme statements" });

// Next month: apply what was learned.
await trueup.reconcileStored({ fileIds: [aprilStatement.id, aprilReceiving.id] }, { model: modelId });
```

| Call | Returns |
|---|---|
| `files.upload(...tables)`, `files.list()`, `files.get(id)` | stored files: `id`, `name`, `rows`, `columns`, `roles` |
| `files.content(id)` | the bytes, exactly as uploaded (`Uint8Array`) |
| `files.delete(id)` | |
| `reconcileStored({ leftFileId, rightFileId } \| { fileIds }, { model, answers })` | a result plus `run_id` (one analysis) |
| `runs.list({ limit, before })` | `{ runs, has_more }`, newest first |
| `runs.all()` | every run (an async iterator that pages for you) |
| `runs.get(id)` | `{ run, result }` |
| `models.create({ runId, name })`, `models.list()`, `models.get(id)`, `models.delete(id)` | `models.get` includes the `weights` |

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
export TRUEUP_API_KEY=tu_live_...   # a key for a test team (each run uses 10 analyses)
just test                            # or: docker compose run --rm test
```

## License

MIT
