// Integration tests against the live TrueUp API. Needs TRUEUP_API_KEY (and optionally TRUEUP_BASE_URL).
// Each full run uses 4 analyses. Run in Docker: `just test` (or `docker compose run --rm test`).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { AuthenticationError, InvalidRequestError, NotFoundError, TrueUp } from "../dist/index.js";

const fixture = (name) => new URL(`./fixtures/${name}`, import.meta.url).pathname;
const live = process.env.TRUEUP_API_KEY ? test : test.skip;

function rows(path) {
  const [head, ...lines] = readFileSync(path, "utf8").trim().split("\n");
  const cols = head.split(",");
  return lines.map((l) => Object.fromEntries(l.split(",").map((v, i) => [cols[i], v])));
}

test("a missing API key fails before any request", () => {
  const saved = process.env.TRUEUP_API_KEY;
  delete process.env.TRUEUP_API_KEY;
  try {
    assert.throws(() => new TrueUp(), (e) => e instanceof AuthenticationError && e.code === "missing_api_key");
  } finally {
    if (saved !== undefined) process.env.TRUEUP_API_KEY = saved;
  }
});

live("account, usage and plans", async () => {
  const tu = new TrueUp();
  const account = await tu.account();
  assert.match(account.key.prefix, /^tu_live_/);
  assert.ok(account.team.id);
  const usage = await tu.usage();
  assert.ok(usage.metrics.some((m) => m.metric === "analyses"));
  const plans = await tu.plans();
  assert.ok(plans.some((p) => p.slug === "free"));
});

let learned = null;

live("reconcile two files: every row paired or explained", async () => {
  const result = await new TrueUp().reconcile({ left: { path: fixture("statement.csv") }, right: { path: fixture("receiving.csv") } });
  assert.equal(result.analysis, "reconcile");
  assert.equal(result.stats.paired, 7);
  assert.deepEqual(result.findings.map((f) => [f.kind, f.subject]), [
    ["qty_mismatch", "statement.csv:row 5"],
    ["phantom", "statement.csv:row 6"],
  ]);
  assert.equal(result.findings[1].amount, 43.2);
  assert.equal(result.details.weights.format, "trueup.match-weights");
  learned = result.details.weights;
});

live("reconcile rows, applying saved weights", async () => {
  const result = await new TrueUp().reconcile({
    left: { name: "statement.csv", rows: rows(fixture("statement.csv")) },
    right: { name: "receiving.csv", rows: rows(fixture("receiving.csv")) },
    weights: learned,
  });
  assert.equal(result.stats.paired, 7);
  assert.equal(result.details.model.learned, false);
});

live("API errors are typed", async () => {
  await assert.rejects(new TrueUp({ apiKey: "tu_live_" + "x".repeat(40) }).account(),
    (e) => e instanceof AuthenticationError && e.status === 401 && e.code === "invalid_api_key");
  await assert.rejects(new TrueUp().reconcile({ left: { path: fixture("statement.csv") }, right: { name: "scan.pdf", content: "%PDF-1.4" } }),
    (e) => e instanceof InvalidRequestError && e.status === 422 && e.code === "unsupported_file");
});

live("stored files: upload, reconcile by id, runs, saved models, download, clean up", async () => {
  const tu = new TrueUp();
  const [statement, receiving] = await tu.files.upload({ path: fixture("statement.csv") }, { path: fixture("receiving.csv") });
  try {
    assert.equal(statement.rows, 8);
    assert.equal((await tu.files.get(receiving.id)).name, "receiving.csv");
    assert.ok((await tu.files.list()).some((f) => f.id === statement.id));
    assert.equal(new TextDecoder().decode(await tu.files.content(statement.id)), readFileSync(fixture("statement.csv"), "utf8"));

    const result = await tu.reconcileStored({ leftFileId: statement.id, rightFileId: receiving.id });
    assert.equal(result.stats.paired, 7);
    assert.match(result.run_id, /^run_/);
    const { run, result: kept } = await tu.runs.get(result.run_id);
    assert.equal(run.status, "done");
    assert.equal(kept.stats.paired, 7);
    const page = await tu.runs.list({ limit: 1 });
    assert.equal(page.runs.length, 1);
    assert.equal(page.has_more, true);
    const next = await tu.runs.list({ limit: 1, before: page.runs[0].id });
    assert.notEqual(next.runs[0].id, page.runs[0].id);

    const modelId = await tu.models.create({ runId: result.run_id, name: "sdk test" });
    try {
      assert.equal((await tu.models.get(modelId)).weights.format, "trueup.match-weights");
      const again = await tu.reconcileStored({ fileIds: [statement.id, receiving.id] }, { model: modelId });
      assert.equal(again.details.model.learned, false);
    } finally {
      await tu.models.delete(modelId);
    }
    await assert.rejects(tu.models.get(modelId), (e) => e instanceof NotFoundError);
  } finally {
    await tu.files.delete(statement.id);
    await tu.files.delete(receiving.id);
  }
  await assert.rejects(tu.files.get(statement.id), (e) => e instanceof NotFoundError);
});
