import assert from "node:assert/strict";
import test from "node:test";
import { POST } from "../app/api/audit/route";
import { analyzeDataset } from "../lib/audit-engine";
import { LIMITS } from "../lib/constants";
import { runFixedRegressionSuite } from "../lib/regression-suite";
import {
  parseSeededDemoDataset,
  SEEDED_DEMO_METADATA,
  SEEDED_DEMO_ROWS,
} from "../lib/demo";
import { createAuditReport } from "../lib/report";
import type { AuditReport, DatasetMetadata, DatasetRow } from "../lib/types";

const governed: DatasetMetadata = {
  datasetName: "Clean synthetic control",
  provenance: "Generated in the unit test with no external source data.",
  license: "CC0-1.0",
  purpose: "Regression control",
  labelColumn: "label",
  splitColumn: "split",
  idColumn: "id",
};

const cleanRows: DatasetRow[] = Array.from({ length: 10 }, (_, index) => ({
  id: `R-${index}`,
  feature: `unit_${index} zone_${index + 20} signal_${index + 50}`,
  label: index % 2 ? "review" : "clear",
  split: index < 8 ? "train" : "test",
}));

test("clean governed control passes all configured detectors", () => {
  const result = analyzeDataset(cleanRows, governed);
  assert.equal(result.status, "PASS");
  assert.deepEqual(result.findings, []);
  assert.equal(result.summary.rowCount, 10);
});

test("fixed demo raises every requested detector family", () => {
  const result = analyzeDataset(SEEDED_DEMO_ROWS, SEEDED_DEMO_METADATA);
  const types = new Set<string>(result.findings.map((finding) => finding.type));
  assert.equal(result.status, "BLOCK");
  for (const expected of [
    "pii",
    "exact-duplicate",
    "near-duplicate",
    "split-leakage",
    "conflicting-label",
    "class-imbalance",
    "missing-provenance",
    "missing-license",
  ]) {
    assert.ok(types.has(expected), `missing ${expected}`);
  }
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /amira\.student@example\.com|900101-13-5678|192\.0\.2\.44/);
  assert.doesNotMatch(serialized, /addresss/);
  assert.match(serialized, /Potential email addresses/);
  assert.match(serialized, /Potential IPv4 addresses/);
  assert.match(serialized, /\[email redacted\]/);
});

test("built-in demo survives browser parsing and request schema validation", async () => {
  const parsed = parseSeededDemoDataset();
  const expectedSchema = [...parsed.columns].sort();
  for (const row of parsed.rows) {
    assert.deepEqual(Object.keys(row).sort(), expectedSchema);
  }

  const response = await POST(new Request("http://localhost/api/audit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ rows: parsed.rows, metadata: SEEDED_DEMO_METADATA }),
  }));
  const report = await response.json() as AuditReport;

  assert.equal(response.status, 200);
  assert.equal(report.status, "BLOCK");
  assert.equal(report.summary.rowCount, SEEDED_DEMO_ROWS.length);
  assert.equal(report.summary.piiCellCount, 4);
  assert.equal(report.summary.exactDuplicatePairs, 1);
  assert.equal(report.summary.leakagePairs, 1);
  assert.equal(report.summary.conflictingGroups, 1);
});

test("report hashes are reproducible while generation timestamps may differ", async () => {
  const first = await createAuditReport(cleanRows, governed);
  const second = await createAuditReport(cleanRows, governed);
  assert.equal(first.datasetHash, second.datasetHash);
  assert.equal(first.configurationHash, second.configurationHash);
  assert.equal(first.reportHash, second.reportHash);
  assert.match(first.datasetHash, /^[a-f0-9]{64}$/);
  assert.match(first.dataCardMarkdown, /not a legal-compliance engine/i);
});

test("operator metadata is inert text in generated Markdown", async () => {
  const report = await createAuditReport(cleanRows, {
    ...governed,
    datasetName: "![dataset](javascript:alert(1))",
    purpose: "[open me](https://attacker.example/purpose)",
    provenance: "<img src=x onerror=alert(1)>",
    license: "https://attacker.example/license",
  });
  const markdown = report.dataCardMarkdown;
  assert.doesNotMatch(markdown, /!\[[^\]]*\]\([^)]*\)/u);
  assert.doesNotMatch(markdown, /\[[^\]]+\]\([^)]*\)/u);
  assert.doesNotMatch(markdown, /<(?:img|script)\b/iu);
  assert.doesNotMatch(markdown, /(?:javascript|https?):\/\//iu);
  assert.match(markdown, /&#33;&#91;dataset&#93;&#40;javascript&#58;/u);
});

test("fixed regression suite matches every maintained expected finding", async () => {
  const suite = await runFixedRegressionSuite();
  assert.equal(suite.id, "dtg-fixed-regression-v1");
  assert.equal(suite.suiteVersion, "1.0.0");
  assert.match(suite.inputArtifactHash, /^[a-f0-9]{64}$/);
  assert.match(suite.goldArtifactHash, /^[a-f0-9]{64}$/);
  assert.equal(suite.byCategory.length, 11);
  assert.equal(suite.cleanRows, 10);
  assert.equal(suite.expectedFindings, 15);
  assert.equal(suite.matchedExpectedFindings, 15);
  assert.equal(suite.unexpectedFindings, 0);
  assert.equal(suite.missedExpectedFindings, 0);
  assert.equal(suite.cleanRowsFlagged, 0);
});

test("serialized reports never echo dataset label or split scalar values", async () => {
  const labelsAndSplits: DatasetRow[] = [
    {
      id: "V-1",
      feature: "same-feature",
      label: "class-owner@example.com",
      split: "train-owner@example.com",
    },
    {
      id: "V-2",
      feature: "same-feature",
      label: "class-owner@example.com",
      split: "test-owner@example.com",
    },
  ];
  const report = await createAuditReport(labelsAndSplits, governed);
  const serialized = JSON.stringify(report);
  assert.doesNotMatch(
    serialized,
    /class-owner@example\.com|train-owner@example\.com|test-owner@example\.com/,
  );
  assert.deepEqual(report.summary.labelDistribution, [{ category: "class-01", count: 2 }]);
  assert.equal(report.summary.leakagePairs, 1);
});

test("numeric Malaysian phone and NRIC-like scalars are scanned without flagging scores", () => {
  const result = analyzeDataset(
    [{
      id: "N-1",
      phone: 60123456789,
      nric: 900101135678,
      score: 0.973,
      label: "clear",
      split: "train",
    }],
    governed,
  );
  const pii = result.findings.filter((item) => item.type === "pii");
  const columns = new Set(pii.flatMap((item) => item.evidence.map((entry) => entry.column)));
  assert.ok(columns.has("phone"));
  assert.ok(columns.has("nric"));
  assert.ok(!columns.has("score"));
  assert.equal(result.summary.piiCellCount, 2);
});

test("hostile label strings cannot corrupt counts or appear in summaries", () => {
  const rows: DatasetRow[] = Array.from({ length: 10 }, (_, index) => ({
    id: `H-${index}`,
    feature: `hostile_${index}`,
    label: index < 8 ? "constructor" : index === 8 ? "__proto__" : "clear",
    split: "train",
  }));
  const result = analyzeDataset(rows, governed);
  assert.deepEqual(result.summary.labelDistribution, [
    { category: "class-01", count: 8 },
    { category: "class-02", count: 1 },
    { category: "class-03", count: 1 },
  ]);
  assert.ok(result.findings.some((item) => item.type === "class-imbalance"));
  assert.doesNotMatch(JSON.stringify(result.summary), /constructor|__proto__/);
});

test("1,000 high-token rows stay inside deterministic near-duplicate work budgets", () => {
  const common = Array.from({ length: 63 }, (_, index) => `c${index.toString(36)}`).join(" ");
  const tail = Array.from({ length: 329 }, () => "z").join(" ");
  const rows: DatasetRow[] = Array.from({ length: 1_000 }, (_, index) => ({
    id: `S-${index}`,
    feature: `${common} r${index.toString(36)} ${tail}`,
    label: "clear",
    split: "train",
  }));
  const requestBytes = new TextEncoder().encode(JSON.stringify({ rows, metadata: governed })).byteLength;
  assert.ok(requestBytes <= LIMITS.requestBytes, `fixture is ${requestBytes} bytes`);
  const started = performance.now();
  const result = analyzeDataset(rows, governed);
  const elapsed = performance.now() - started;
  const finding = result.findings.find((item) => item.type === "near-duplicate");
  assert.ok(finding);
  assert.equal(result.summary.nearDuplicateComparisons, LIMITS.pairComparisons);
  assert.equal(result.summary.nearDuplicateComparisonLimit, LIMITS.pairComparisons);
  assert.equal(result.summary.nearDuplicatePairs, LIMITS.pairComparisons);
  assert.equal(result.summary.nearDuplicatePairScanCapped, true);
  assert.equal(result.summary.nearDuplicateTokenLimit, LIMITS.nearDuplicateTokenMatchesPerRow);
  assert.equal(result.summary.nearDuplicateRowsAtTokenLimit, 1_000);
  assert.equal(finding.evidence.length, 6);
  assert.ok(JSON.stringify(result).length < 25_000);
  assert.ok(elapsed < 10_000, `budgeted stress scan took ${elapsed.toFixed(0)} ms`);
});
