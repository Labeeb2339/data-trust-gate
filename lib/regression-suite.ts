import { analyzeDataset } from "./audit-engine";
import { sha256Hex } from "./hash";
import type {
  AuditFinding,
  RegressionCaseResult,
  RegressionCategoryResult,
  RegressionSuiteReport,
  DatasetMetadata,
  DatasetRow,
} from "./types";

const SUITE_ID = "dtg-fixed-regression-v1";
const SUITE_VERSION = "1.0.0";

const GOVERNED_METADATA: DatasetMetadata = {
  datasetName: "Synthetic fixed regression fixture",
  provenance: "Static synthetic fixture maintained in the DataTrust Gate v1 regression suite.",
  license: "CC0-1.0 synthetic fixture",
  purpose: "Detector regression testing only.",
  labelColumn: "label",
  splitColumn: "split",
  idColumn: "id",
};

interface RegressionFixture {
  id: string;
  kind: RegressionCaseResult["kind"];
  rows: DatasetRow[];
  metadata: DatasetMetadata;
}

const cleanRows: DatasetRow[] = Array.from({ length: 10 }, (_, index) => ({
  id: `C-${index + 1}`,
  feature: `token_${index + 1} sector_${index % 3} sample_${300 + index}`,
  score: index / 10,
  label: index % 2 === 0 ? "clear" : "review",
  split: index < 8 ? "train" : "test",
}));

const imbalanceRows: DatasetRow[] = Array.from({ length: 10 }, (_, index) => ({
  id: `I-${index + 1}`,
  feature: `imb_${index + 1} parcel_${index + 20} reading_${index + 90}`,
  label: index === 9 ? "review" : "clear",
  split: "train",
}));

const FIXTURES: RegressionFixture[] = [
  {
    id: "clean-control",
    kind: "clean-control",
    rows: cleanRows,
    metadata: GOVERNED_METADATA,
  },
  {
    id: "pii-single",
    kind: "single-fault",
    rows: [
      { id: "P-01", feature: "alpha", contact: "synthetic.person@example.com", label: "clear", split: "train" },
      { id: "P-02", feature: "bravo", contact: "+60 13-222 3344", label: "review", split: "train" },
      { id: "P-03", feature: "charlie", identity: "010203-04-5678", label: "clear", split: "test" },
      { id: "P-04", feature: "delta", source_ip: "198.51.100.24", label: "review", split: "test" },
    ],
    metadata: GOVERNED_METADATA,
  },
  {
    id: "exact-single",
    kind: "single-fault",
    rows: [
      { id: "E-01", feature: "identical_record", score: 0.4, label: "clear", split: "train" },
      { id: "E-02", feature: "identical_record", score: 0.4, label: "clear", split: "train" },
    ],
    metadata: GOVERNED_METADATA,
  },
  {
    id: "near-single",
    kind: "single-fault",
    rows: [
      { id: "N-01", feature: "forest canopy survey camera records hornbill flight near river ridge during dry season", label: "clear", split: "train" },
      { id: "N-02", feature: "forest canopy survey camera records hornbill flight near river ridge during wet season", label: "clear", split: "train" },
    ],
    metadata: GOVERNED_METADATA,
  },
  {
    id: "leakage-single",
    kind: "single-fault",
    rows: [
      { id: "L-01", feature: "parcel_delta", score: 0.72, label: "review", split: "train" },
      { id: "L-02", feature: "parcel_delta", score: 0.72, label: "review", split: "test" },
    ],
    metadata: GOVERNED_METADATA,
  },
  {
    id: "conflict-single",
    kind: "single-fault",
    rows: [
      { id: "F-01", feature: "tile_echo", score: 0.28, label: "clear", split: "train" },
      { id: "F-02", feature: "tile_echo", score: 0.28, label: "review", split: "train" },
    ],
    metadata: GOVERNED_METADATA,
  },
  {
    id: "imbalance-single",
    kind: "single-fault",
    rows: imbalanceRows,
    metadata: GOVERNED_METADATA,
  },
  {
    id: "provenance-single",
    kind: "single-fault",
    rows: [{ id: "M-01", feature: "one", label: "clear", split: "train" }],
    metadata: { ...GOVERNED_METADATA, provenance: "" },
  },
  {
    id: "license-single",
    kind: "single-fault",
    rows: [{ id: "M-02", feature: "two", label: "review", split: "test" }],
    metadata: { ...GOVERNED_METADATA, license: "" },
  },
  {
    id: "compound-governance",
    kind: "compound-fault",
    rows: [
      { id: "G-01", feature: "cedar", contact: "compound@example.com", label: "clear", split: "train" },
      { id: "G-02", feature: "maple", source_ip: "203.0.113.9", label: "review", split: "test" },
    ],
    metadata: { ...GOVERNED_METADATA, provenance: "", license: "" },
  },
];

// Gold labels are deliberately maintained outside the detector inputs.
const GOLD_LABELS: Record<string, string[]> = {
  "clean-control": [],
  "pii-single": [
    "pii-single|pii-email|P-01|contact",
    "pii-single|pii-phone|P-02|contact",
    "pii-single|pii-nric|P-03|identity",
    "pii-single|pii-ip|P-04|source_ip",
  ],
  "exact-single": ["exact-single|exact-duplicate|E-01|E-02"],
  "near-single": ["near-single|near-duplicate|N-01|N-02"],
  "leakage-single": ["leakage-single|split-leakage|L-01|L-02"],
  "conflict-single": ["conflict-single|conflicting-label|F-01|F-02"],
  "imbalance-single": ["imbalance-single|class-imbalance|label"],
  "provenance-single": ["provenance-single|missing-provenance|metadata"],
  "license-single": ["license-single|missing-license|metadata"],
  "compound-governance": [
    "compound-governance|pii-email|G-01|contact",
    "compound-governance|pii-ip|G-02|source_ip",
    "compound-governance|missing-provenance|metadata",
    "compound-governance|missing-license|metadata",
  ],
};

const CATEGORIES = [
  "pii-email",
  "pii-phone",
  "pii-nric",
  "pii-ip",
  "exact-duplicate",
  "near-duplicate",
  "split-leakage",
  "conflicting-label",
  "class-imbalance",
  "missing-provenance",
  "missing-license",
];

function findingCategory(finding: AuditFinding) {
  return finding.type === "pii" ? finding.id : finding.type;
}

function rowId(rows: DatasetRow[], rowNumber?: number) {
  if (!rowNumber) return null;
  const value = rows[rowNumber - 1]?.id;
  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : `row-${rowNumber}`;
}

function predictionKeys(fixture: RegressionFixture, findings: AuditFinding[]) {
  const predictions = new Set<string>();
  for (const item of findings) {
    const category = findingCategory(item);
    for (const evidence of item.evidence) {
      if (category === "class-imbalance") {
        predictions.add(`${fixture.id}|${category}|${item.evidence[0]?.column ?? "label"}`);
      } else if (category === "missing-provenance" || category === "missing-license") {
        predictions.add(`${fixture.id}|${category}|metadata`);
      } else if (category.startsWith("pii-")) {
        predictions.add(
          `${fixture.id}|${category}|${rowId(fixture.rows, evidence.row)}|${evidence.column ?? "unknown"}`,
        );
      } else {
        const ids = [rowId(fixture.rows, evidence.row), rowId(fixture.rows, evidence.otherRow)]
          .filter((value): value is string => Boolean(value))
          .sort();
        predictions.add(`${fixture.id}|${category}|${ids.join("|")}`);
      }
    }
  }
  return predictions;
}

function categoryOf(key: string) {
  return key.split("|")[1] ?? "unknown";
}

export async function runFixedRegressionSuite(): Promise<RegressionSuiteReport> {
  const allGold = new Set(Object.values(GOLD_LABELS).flat());
  const allPredictions = new Set<string>();
  const results: RegressionCaseResult[] = [];
  let cleanRowsFlagged = 0;

  for (const fixture of FIXTURES) {
    const analysis = analyzeDataset(fixture.rows, fixture.metadata);
    const predicted = predictionKeys(fixture, analysis.findings);
    const expected = new Set(GOLD_LABELS[fixture.id] ?? []);
    predicted.forEach((key) => allPredictions.add(key));

    const matched = [...predicted].filter((key) => expected.has(key)).length;
    const unexpected = [...predicted].filter((key) => !expected.has(key)).length;
    const missed = [...expected].filter((key) => !predicted.has(key)).length;
    results.push({
      id: fixture.id,
      kind: fixture.kind,
      expected: expected.size,
      matched,
      unexpected,
      missed,
    });

    if (fixture.kind === "clean-control") {
      const flagged = new Set<string>();
      for (const item of analysis.findings) {
        for (const evidence of item.evidence) {
          const first = rowId(fixture.rows, evidence.row);
          const second = rowId(fixture.rows, evidence.otherRow);
          if (first) flagged.add(first);
          if (second) flagged.add(second);
        }
      }
      cleanRowsFlagged = flagged.size;
    }
  }

  const byCategory: RegressionCategoryResult[] = CATEGORIES.map((category) => {
    const expected = new Set([...allGold].filter((key) => categoryOf(key) === category));
    const predicted = new Set([...allPredictions].filter((key) => categoryOf(key) === category));
    return {
      category,
      expected: expected.size,
      matched: [...predicted].filter((key) => expected.has(key)).length,
      unexpected: [...predicted].filter((key) => !expected.has(key)).length,
      missed: [...expected].filter((key) => !predicted.has(key)).length,
    };
  });

  const matchedExpectedFindings = [...allPredictions].filter((key) => allGold.has(key)).length;
  const unexpectedFindings = [...allPredictions].filter((key) => !allGold.has(key)).length;
  const missedExpectedFindings = [...allGold].filter((key) => !allPredictions.has(key)).length;

  return {
    id: SUITE_ID,
    suiteVersion: SUITE_VERSION,
    inputArtifactHash: await sha256Hex(FIXTURES),
    goldArtifactHash: await sha256Hex(GOLD_LABELS),
    cases: FIXTURES.length,
    expectedFindings: allGold.size,
    matchedExpectedFindings,
    unexpectedFindings,
    missedExpectedFindings,
    cleanRows: cleanRows.length,
    cleanRowsFlagged,
    byCategory,
    results,
    scope:
      "Fixed synthetic regression fixtures only. The result confirms expected rule behavior on maintained examples; it is not a precision, recall, field-accuracy, legal-compliance, or generalisation claim.",
  };
}
