/**
 * TrueUp API client.
 *
 *     import { TrueUp } from "trueup";
 *     const trueup = new TrueUp();                      // reads TRUEUP_API_KEY
 *     const result = await trueup.reconcile({
 *       left: { path: "statement.csv" },                // the side that bills or claims
 *       right: { path: "receiving.csv" },
 *     });
 *     for (const f of result.findings) console.log(f.kind, f.subject, f.detail);
 */

export const VERSION = "0.1.0";
export const DEFAULT_BASE_URL = "https://trueup-cloud.merchantprotocol.workers.dev";

/** A cell in a row. */
export type Cell = string | number | boolean | null;
/** A row: column name -> value. */
export type Row = Record<string, Cell>;

/**
 * One table to reconcile: a file on disk (Node), file contents, or rows.
 * `name` is how findings refer to its rows ("statement.csv:row 5").
 */
export type TableInput =
  | { path: string; name?: string }
  | { name: string; content: string | Uint8Array | ArrayBuffer | Blob }
  | { name: string; rows: Row[] };

export interface Answers {
  /** Pairs a person confirmed: [left row, right row], e.g. ["statement.csv:row 3", "receiving.csv:row 4"]. */
  same?: [string, string][];
  /** Pairs a person rejected. */
  different?: [string, string][];
}

export interface ReconcileOptions {
  /** `details.weights` from an earlier result: apply what was learned then instead of learning again. */
  weights?: Record<string, unknown>;
  answers?: Answers;
}

export interface Finding {
  /** phantom | unbilled | duplicate | received_duplicate | qty_mismatch | price_change | amount_mismatch | unsure_pair */
  kind: string;
  label: string;
  /** The row it is about: "statement.csv:row 5". */
  subject: string;
  detail: string;
  /** How likely the pairing is right; null for rows with no pair. */
  confidence: number | null;
  status: "yes" | "unsure";
  amount: number | null;
  provenance: string[];
  data: Record<string, unknown>;
}

export interface ReconcileResult {
  analysis: string;
  title: string;
  headline: string;
  stats: Record<string, number>;
  findings: Finding[];
  details: {
    model: Record<string, unknown>;
    weights: Record<string, unknown> | null;
    pairs: { left: string; right: string; confidence: number }[];
    [key: string]: unknown;
  };
  inputs: string[];
  engine?: string;
  [key: string]: unknown;
}

export interface Account {
  team: { id: string; name: string };
  plan: { slug: string; name: string } | null;
  key: { id: string; name: string; prefix: string };
}

export interface UsageMetric {
  metric: string;
  label: string;
  used: number;
  included: number;
  remaining: number;
  hard_cap: boolean;
  overage: number;
}

export interface Usage {
  period: string;
  resets_at: string;
  metrics: UsageMetric[];
}

export interface Plan {
  slug: string;
  name: string;
  description: string;
  price_cents: number;
  interval: string;
  purchasable: boolean;
  limits: { metric: string; included: number; hard_cap: boolean; overage_micros_per_unit: number | null }[];
}

// ------------------------------------------------------------------ errors

/** Any error the API returned, or a failure to reach it. `code` is the API's error code; branch on it. */
export class TrueUpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly body: unknown;
  constructor(message: string, status = 0, code = "connection_error", body: unknown = null) {
    super(message);
    this.name = new.target.name;
    this.status = status;
    this.code = code;
    this.body = body;
  }
}
/** 401: missing, unknown or revoked API key. */
export class AuthenticationError extends TrueUpError {}
/** 400, 413, 415, 422: the request or the files need fixing. */
export class InvalidRequestError extends TrueUpError {}
/** 404, 405 */
export class NotFoundError extends TrueUpError {}
/** 429 rate_limited: slow down; `retryAfter` seconds. */
export class RateLimitError extends TrueUpError {
  retryAfter: number | null = null;
}
/** 429 quota_exceeded: the team used its plan's allowance this month. Retrying won't help. */
export class QuotaExceededError extends TrueUpError {}
/** 5xx */
export class ServerError extends TrueUpError {}
/** The API couldn't be reached, or took too long. */
export class ConnectionError extends TrueUpError {}

function errorFor(status: number, code: string, message: string, body: unknown, retryAfter: string | null): TrueUpError {
  if (status === 401) return new AuthenticationError(message, status, code, body);
  if (status === 429 && code === "quota_exceeded") return new QuotaExceededError(message, status, code, body);
  if (status === 429) {
    const e = new RateLimitError(message, status, code, body);
    e.retryAfter = retryAfter ? Number(retryAfter) : null;
    return e;
  }
  if (status === 404 || status === 405) return new NotFoundError(message, status, code, body);
  if (status >= 500) return new ServerError(message, status, code, body);
  return new InvalidRequestError(message, status, code, body);
}

// ------------------------------------------------------------------ client

export interface ClientOptions {
  /** Defaults to the TRUEUP_API_KEY environment variable. */
  apiKey?: string;
  /** Defaults to TRUEUP_BASE_URL, then the hosted API. */
  baseUrl?: string;
  /** Per request, in milliseconds. Default 300000 (big ledgers take a while). */
  timeoutMs?: number;
  /** Retries for rate limits, server errors and dropped connections. Default 2. */
  maxRetries?: number;
  /** A fetch implementation (defaults to the global one). */
  fetch?: typeof fetch;
}

function env(name: string): string | undefined {
  const p = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  return p?.env?.[name] || undefined; // empty counts as unset
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class TrueUp {
  readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: ClientOptions = {}) {
    const apiKey = options.apiKey || env("TRUEUP_API_KEY");
    if (!apiKey) {
      throw new AuthenticationError("No API key: pass { apiKey } or set TRUEUP_API_KEY. Create one in the TrueUp dashboard under API keys.", 0, "missing_api_key");
    }
    this.apiKey = apiKey;
    this.baseUrl = (options.baseUrl || env("TRUEUP_BASE_URL") || DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.timeoutMs = options.timeoutMs ?? 300_000;
    this.maxRetries = options.maxRetries ?? 2;
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  /** The team, plan and key behind this client's API key. */
  account(): Promise<Account> {
    return this.request("GET", "/v1/account");
  }

  /** This month's usage for the key's team. */
  usage(): Promise<Usage> {
    return this.request("GET", "/v1/usage");
  }

  /** The plans a team can be on. */
  async plans(): Promise<Plan[]> {
    return (await this.request<{ plans: Plan[] }>("GET", "/v1/plans")).plans;
  }

  /**
   * Reconcile two tables: `left` is the side that bills or claims (a statement, your books), `right` the other
   * side (receiving log, bank feed). Every row comes back paired, flagged or explained. One analysis.
   */
  async reconcile(input: { left: TableInput; right: TableInput } & ReconcileOptions): Promise<ReconcileResult> {
    const { left, right, weights, answers } = input;
    if ("rows" in left && "rows" in right) {
      return this.request("POST", "/v1/reconcile", {
        json: { left: { name: left.name, rows: left.rows }, right: { name: right.name, rows: right.rows }, weights, answers },
      });
    }
    const form = new FormData();
    form.set("left", ...(await asFile(left)));
    form.set("right", ...(await asFile(right)));
    addOptions(form, { weights, answers });
    return this.request("POST", "/v1/reconcile", { form });
  }

  /** Send two or more files; TrueUp picks the pair to reconcile and which side is which. One analysis. */
  async reconcileFiles(files: TableInput[], options: ReconcileOptions = {}): Promise<ReconcileResult> {
    const form = new FormData();
    for (const f of files) form.append("files", ...(await asFile(f)));
    addOptions(form, options);
    return this.request("POST", "/v1/reconcile", { form });
  }

  // ---------------------------------------------------------------- transport

  private async request<T>(method: string, path: string, body: { json?: unknown; form?: FormData } = {}): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const headers: Record<string, string> = {
        authorization: `Bearer ${this.apiKey}`,
        accept: "application/json",
        "user-agent": `trueup-js/${VERSION}`,
      };
      let payload: BodyInit | undefined;
      if (body.json !== undefined) {
        headers["content-type"] = "application/json";
        payload = JSON.stringify(body.json);
      } else if (body.form) {
        payload = body.form;
      }
      let res: Response;
      try {
        res = await this.fetchImpl(this.baseUrl + path, { method, headers, body: payload, signal: AbortSignal.timeout(this.timeoutMs) });
      } catch (e) {
        if (attempt < this.maxRetries) {
          await sleep(backoff(attempt));
          continue;
        }
        throw new ConnectionError(`Couldn't reach TrueUp at ${this.baseUrl}: ${(e as Error).message}`, 0, "connection_error");
      }
      const text = await res.text();
      let data: unknown = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = text;
      }
      if (res.ok) return data as T;
      const err = (data as { error?: { code?: string; message?: string } })?.error;
      const error = errorFor(res.status, err?.code ?? `http_${res.status}`, err?.message ?? `HTTP ${res.status}`, data, res.headers.get("retry-after"));
      const retryable = error instanceof RateLimitError || error instanceof ServerError;
      if (retryable && attempt < this.maxRetries) {
        const wait = error instanceof RateLimitError && error.retryAfter ? error.retryAfter * 1000 : backoff(attempt);
        await sleep(wait);
        continue;
      }
      throw error;
    }
  }
}

function backoff(attempt: number): number {
  return Math.min(30_000, 1000 * 2 ** attempt) * (0.5 + Math.random() / 2);
}

function addOptions(form: FormData, { weights, answers }: ReconcileOptions) {
  if (weights) form.set("weights", JSON.stringify(weights));
  if (answers) form.set("answers", JSON.stringify(answers));
}

async function asFile(input: TableInput): Promise<[Blob, string]> {
  if ("path" in input) {
    const { readFile } = await import("node:fs/promises");
    const { basename } = await import("node:path");
    return [new Blob([(await readFile(input.path)) as unknown as BlobPart]), input.name ?? basename(input.path)];
  }
  if ("rows" in input) {
    return [new Blob([JSON.stringify(input.rows)], { type: "application/json" }), input.name.replace(/\.[^.]*$/, "") + ".json"];
  }
  const c = input.content;
  return [c instanceof Blob ? c : new Blob([c as BlobPart]), input.name];
}

export default TrueUp;
