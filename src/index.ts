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
 *
 *     const matched = await trueup.match({ left: { path: "invoice.csv" }, right: { path: "catalog.csv" } });
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

export interface MatchFinding extends Omit<Finding, "kind"> {
  /** match | unsure_match | only_left | only_right */
  kind: string;
}

/** The answer to a match call. */
export interface MatchResult {
  analysis: "match";
  title: string;
  headline: string;
  stats: Record<string, number>;
  findings: MatchFinding[];
  details: {
    /** How each list's columns were lined up: {original name: shared name}. */
    columns: { left: Record<string, string>; right: Record<string, string> };
    /** [left id, right id, confidence] for every pair. */
    pairs: [string, string, number][];
    model: { learned: boolean };
    /** What was learned: pass back as `weights` to match the same way without learning. */
    weights: Record<string, unknown> | null;
    [key: string]: unknown;
  };
  inputs: string[];
  engine?: string;
  /** The kept run, for `matchStored`. */
  run_id?: string;
  [key: string]: unknown;
}

/** The answer to an audit call: documents (analysis "audit") or a table's rows (analysis "table-audit"). */
export interface AuditResult {
  analysis: "audit" | "table-audit";
  title: string;
  headline: string;
  stats: Record<string, number>;
  /** kind: arithmetic (numbers break a law; amount is how far off) or duplicate_row. */
  findings: Finding[];
  details: {
    /** Every law learned (or applied): "subtotal + tax amount = total", and how often it held. */
    laws: { scope?: string; law: string; held: string }[];
    model: { learned: boolean };
    /** Pass back as `weights` to check new documents or rows against the same laws. */
    weights: Record<string, unknown>;
    [key: string]: unknown;
  };
  inputs: string[];
  engine?: string;
  run_id?: string;
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

/** A file stored in the team (uploaded through the API or the dashboard). */
export interface StoredFile {
  id: string;
  name: string;
  size?: number;
  /** "table" or "document". */
  kind: string;
  rows: number | null;
  columns: string[];
  /** What TrueUp read each column as: "date", "number", "text", ... */
  roles: Record<string, string> | null;
  created_at?: string;
}

export interface Run {
  id: string;
  analysis: string;
  /** "done" or "failed". */
  status: string;
  /** "api" or "portal". */
  via: string;
  inputs: string[];
  model: { id: string; name: string } | null;
  headline: string | null;
  stats: Record<string, number> | null;
  /** How many findings the run has. */
  findings: number | null;
  error: string | null;
  created_at: string;
}

export interface Model {
  id: string;
  name: string;
  analysis: string;
  source_run_id: string | null;
  created_at: string;
  /** Only from `models.get`: what was learned, usable as `weights`. */
  weights?: Record<string, unknown>;
}

/** Files already uploaded to the team, by id: two with sides, or several for TrueUp to pick from. */
export type StoredInput = { leftFileId: string; rightFileId: string } | { fileIds: string[] };

export interface StoredReconcileOptions {
  /** A saved model id: apply what it learned instead of learning again. */
  model?: string;
  answers?: Answers;
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

  /**
   * Match two lists that describe the same things in different words (two catalogs, a price book and an invoice):
   * each record on `left` (the list to go through) is paired with its counterpart on `right` (the list to search),
   * or reported as having none. One analysis.
   */
  async match(input: { left: TableInput; right: TableInput; weights?: Record<string, unknown> }): Promise<MatchResult> {
    const { left, right, weights } = input;
    if ("rows" in left && "rows" in right) {
      return this.request("POST", "/v1/match", { json: { left: { name: left.name, rows: left.rows }, right: { name: right.name, rows: right.rows }, weights } });
    }
    const form = new FormData();
    form.set("left", ...(await asFile(left)));
    form.set("right", ...(await asFile(right)));
    addOptions(form, { weights });
    return this.request("POST", "/v1/match", { form });
  }

  /** Send two or more lists; TrueUp picks the pair to match and puts the shorter on the left. One analysis. */
  async matchFiles(files: TableInput[], options: { weights?: Record<string, unknown> } = {}): Promise<MatchResult> {
    const form = new FormData();
    for (const f of files) form.append("files", ...(await asFile(f)));
    addOptions(form, options);
    return this.request("POST", "/v1/match", { form });
  }

  /** Match lists already uploaded to the team, by id; `model` applies a saved match model. The run is kept. One analysis. */
  matchStored(input: StoredInput, options: { model?: string } = {}): Promise<MatchResult & { run_id: string }> {
    const ids = "fileIds" in input ? { file_ids: input.fileIds } : { left_file_id: input.leftFileId, right_file_id: input.rightFileId };
    return this.request("POST", "/v1/match", { json: { ...ids, model: options.model } });
  }

  /**
   * Find what doesn't add up. Text documents (invoices, statements, 4 or more of a kind): TrueUp learns the
   * arithmetic each kind obeys and flags the ones that break it. One table: the same for its rows, plus repeated
   * rows. `weights` (details.weights of an earlier audit) checks new documents against the same laws. One analysis.
   */
  async audit(files: TableInput[], options: { weights?: Record<string, unknown> } = {}): Promise<AuditResult> {
    if (!files.length) throw new InvalidRequestError("Pass the documents (or one table) to audit.", 0, "invalid_request");
    const form = new FormData();
    for (const f of files) form.append("files", ...(await asFile(f)));
    addOptions(form, options);
    return this.request("POST", "/v1/audit", { form });
  }

  /** Audit files already uploaded to the team, by id; `model` applies a saved audit model. The run is kept. One analysis. */
  auditStored(fileIds: string[], options: { model?: string } = {}): Promise<AuditResult & { run_id: string }> {
    return this.request("POST", "/v1/audit", { json: { file_ids: fileIds, model: options.model } });
  }

  /**
   * Reconcile files already uploaded to the team (see `files.upload`). The run is kept: its id comes back as
   * `run_id` and `runs.get` returns it later. One analysis.
   */
  reconcileStored(input: StoredInput, options: StoredReconcileOptions = {}): Promise<ReconcileResult & { run_id: string }> {
    const ids = "fileIds" in input ? { file_ids: input.fileIds } : { left_file_id: input.leftFileId, right_file_id: input.rightFileId };
    return this.request("POST", "/v1/reconcile", { json: { ...ids, model: options.model, answers: options.answers } });
  }

  /** The team's stored files. */
  readonly files = {
    /** Upload one or more files; each comes back with its id and what TrueUp read in it. */
    upload: async (...inputs: TableInput[]): Promise<StoredFile[]> => {
      if (!inputs.length) throw new InvalidRequestError("Pass at least one file to upload.", 0, "invalid_request");
      const form = new FormData();
      for (const f of inputs) form.append("file", ...(await asFile(f)));
      return (await this.request<{ files: StoredFile[] }>("POST", "/v1/files", { form })).files;
    },
    list: async (): Promise<StoredFile[]> => (await this.request<{ files: StoredFile[] }>("GET", "/v1/files")).files,
    get: async (id: string): Promise<StoredFile> => (await this.request<{ file: StoredFile }>("GET", `/v1/files/${enc(id)}`)).file,
    /** The file's bytes, exactly as uploaded. */
    content: (id: string): Promise<Uint8Array> => this.request("GET", `/v1/files/${enc(id)}/content`, { raw: true }),
    delete: async (id: string): Promise<void> => { await this.request("DELETE", `/v1/files/${enc(id)}`); },
  };

  /** Runs on stored files (from the API or the dashboard), newest first. */
  readonly runs = {
    /** One page: up to `limit` (1-100) runs older than the run id `before`. */
    list: (options: { limit?: number; before?: string } = {}): Promise<{ runs: Run[]; has_more: boolean }> => {
      const q = new URLSearchParams();
      if (options.limit !== undefined) q.set("limit", String(options.limit));
      if (options.before) q.set("before", options.before);
      return this.request("GET", `/v1/runs${q.size ? `?${q}` : ""}`);
    },
    /** Every run, page by page. */
    all: (): AsyncGenerator<Run> => this.allRuns(),
    /** One run and its full result (the same shape `reconcile` returns). */
    get: (id: string): Promise<{ run: Run; result: ReconcileResult | null }> => this.request("GET", `/v1/runs/${enc(id)}`),
  };

  /** Saved models: what a run learned, reusable on next month's files. */
  readonly models = {
    list: async (): Promise<Model[]> => (await this.request<{ models: Model[] }>("GET", "/v1/models")).models,
    /** Save what a run learned. Returns the new model's id. */
    create: async (input: { runId: string; name?: string }): Promise<string> =>
      (await this.request<{ id: string }>("POST", "/v1/models", { json: { run_id: input.runId, name: input.name } })).id,
    /** One model, with its `weights`. */
    get: async (id: string): Promise<Model> => (await this.request<{ model: Model }>("GET", `/v1/models/${enc(id)}`)).model,
    delete: async (id: string): Promise<void> => { await this.request("DELETE", `/v1/models/${enc(id)}`); },
  };

  private async *allRuns(): AsyncGenerator<Run> {
    let before: string | undefined;
    for (;;) {
      const page = await this.runs.list({ limit: 100, before });
      yield* page.runs;
      if (!page.has_more || !page.runs.length) return;
      before = page.runs[page.runs.length - 1].id;
    }
  }

  // ---------------------------------------------------------------- transport

  private async request<T>(method: string, path: string, body: { json?: unknown; form?: FormData; raw?: boolean } = {}): Promise<T> {
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
      if (res.ok && body.raw) return new Uint8Array(await res.arrayBuffer()) as T;
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

const enc = encodeURIComponent;

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
