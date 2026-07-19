import assert from "node:assert/strict";
import test from "node:test";

const workerUrl = new URL("../dist/server/index.js", import.meta.url);

async function loadWorker() {
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}-${Math.random()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker;
}

const runtime = {
  ASSETS: {
    fetch: async () => new Response("Not found", { status: 404 }),
  },
};

const context = {
  waitUntil() {},
  passThroughOnException() {},
};

test("server-renders the finished release auditor", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    runtime,
    context,
  );
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /<title>DataTrust Gate — AI Dataset Release Auditor<\/title>/i);
  assert.match(html, /Find the evidence/);
  assert.match(html, /No storage/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|react-loading-skeleton/i);
});

test("audit route returns a masked, non-stored report", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(
    new Request("http://localhost/api/audit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        rows: [
          { id: "1", text: "contact synthetic.person@example.com", label: "clear", split: "train" },
          { id: "2", text: "unique record", label: "review", split: "test" },
        ],
        metadata: {
          datasetName: "Integration fixture",
          provenance: "Synthetic integration fixture",
          license: "CC0-1.0",
          purpose: "Route test",
          labelColumn: "label",
          splitColumn: "split",
          idColumn: "id",
        },
      }),
    }),
    runtime,
    context,
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store, max-age=0");
  const body = await response.text();
  assert.doesNotMatch(body, /synthetic\.person@example\.com/);
  const report = JSON.parse(body);
  assert.equal(report.status, "BLOCK");
  assert.equal(report.summary.piiCellCount, 1);
  assert.equal(report.findings[0].evidence[0].maskedValue, "[email redacted]");
});

test("audit route rejects malformed nested rows", async () => {
  const worker = await loadWorker();
  const cellCanary = "CELL_VALUE_CANARY_7bc91";
  const response = await worker.fetch(
    new Request("http://localhost/api/audit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rows: [{ nested: { unsafe: cellCanary } }], metadata: {} }),
    }),
    runtime,
    context,
  );
  assert.equal(response.status, 400);
  assert.equal(response.headers.get("cache-control"), "no-store, max-age=0");
  assert.doesNotMatch(await response.text(), new RegExp(cellCanary, "u"));
});

test("audit route uses a fixed malformed-JSON error without echoing body fragments", async () => {
  const worker = await loadWorker();
  const canary = "MALFORMED_BODY_CANARY_48fa2";
  const response = await worker.fetch(
    new Request("http://localhost/api/audit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: `{"rows":[${canary}`,
    }),
    runtime,
    context,
  );
  assert.equal(response.status, 400);
  const body = await response.text();
  assert.doesNotMatch(body, new RegExp(canary, "u"));
  assert.deepEqual(JSON.parse(body), { error: "The audit request contains malformed JSON." });
});

test("audit route rejects empty, colliding, and inconsistent row schemas", async () => {
  const worker = await loadWorker();
  for (const rows of [
    [{}],
    [{ label: "a", " Label ": "b" }],
    [{ id: 1, label: "a" }, { id: 2, other: "b" }],
  ]) {
    const response = await worker.fetch(
      new Request("http://localhost/api/audit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rows, metadata: {} }),
      }),
      runtime,
      context,
    );
    assert.equal(response.status, 400);
  }
});

test("audit route bounds memory across many tiny streamed chunks", async () => {
  const worker = await loadWorker();
  const tinyChunkCount = 50_000;
  let tinyChunksSent = 0;
  let terminalChunkSent = false;
  const oversized = new ReadableStream({
    pull(controller) {
      if (tinyChunksSent < tinyChunkCount) {
        controller.enqueue(Uint8Array.of(0x78));
        tinyChunksSent += 1;
        return;
      }
      if (!terminalChunkSent) {
        controller.enqueue(new Uint8Array(1_450_001).fill(0x78));
        terminalChunkSent = true;
        return;
      }
      controller.close();
    },
  });
  const response = await worker.fetch(
    new Request("http://localhost/api/audit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: oversized,
      duplex: "half",
    }),
    runtime,
    context,
  );
  assert.equal(response.status, 413);
  assert.equal(response.headers.get("cache-control"), "no-store, max-age=0");
  assert.equal(tinyChunksSent, tinyChunkCount);
  assert.equal(terminalChunkSent, true);
});
