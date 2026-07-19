export type DatasetScalar = string | number | boolean | null;

export type DatasetRow = Record<string, DatasetScalar>;

export type GateStatus = "BLOCK" | "WARN" | "PASS";

export type FindingSeverity = "block" | "warn" | "pass";

export type FindingType =
  | "pii"
  | "exact-duplicate"
  | "near-duplicate"
  | "split-leakage"
  | "conflicting-label"
  | "class-imbalance"
  | "missing-provenance"
  | "missing-license";

export interface DatasetMetadata {
  datasetName: string;
  provenance: string;
  license: string;
  purpose: string;
  labelColumn: string;
  splitColumn: string;
  idColumn: string;
}

export interface FindingEvidence {
  key: string;
  row?: number;
  otherRow?: number;
  column?: string;
  maskedValue?: string;
  detail: string;
}

export interface AuditFinding {
  id: string;
  type: FindingType;
  severity: Exclude<FindingSeverity, "pass">;
  title: string;
  summary: string;
  count: number;
  evidence: FindingEvidence[];
  remediation: string;
}

export interface AuditSummary {
  rowCount: number;
  columnCount: number;
  blockCount: number;
  warningCount: number;
  piiCellCount: number;
  exactDuplicatePairs: number;
  nearDuplicatePairs: number;
  leakagePairs: number;
  conflictingGroups: number;
  labelDistribution: Array<{
    category: string;
    count: number;
  }>;
  nearDuplicateComparisons: number;
  nearDuplicateComparisonLimit: number;
  nearDuplicatePairScanCapped: boolean;
  nearDuplicateTokenLimit: number;
  nearDuplicateRowsAtTokenLimit: number;
  inferredColumns: {
    label: string | null;
    split: string | null;
    id: string | null;
  };
}

export interface RegressionCategoryResult {
  category: string;
  expected: number;
  matched: number;
  unexpected: number;
  missed: number;
}

export interface RegressionCaseResult {
  id: string;
  kind: "clean-control" | "single-fault" | "compound-fault";
  expected: number;
  matched: number;
  unexpected: number;
  missed: number;
}

export interface RegressionSuiteReport {
  id: string;
  suiteVersion: string;
  inputArtifactHash: string;
  goldArtifactHash: string;
  cases: number;
  expectedFindings: number;
  matchedExpectedFindings: number;
  unexpectedFindings: number;
  missedExpectedFindings: number;
  cleanRows: number;
  cleanRowsFlagged: number;
  byCategory: RegressionCategoryResult[];
  results: RegressionCaseResult[];
  scope: string;
}

export interface AuditReport {
  schemaVersion: "1.0";
  status: GateStatus;
  generatedAt: string;
  datasetHash: string;
  configurationHash: string;
  reportHash: string;
  metadata: DatasetMetadata;
  summary: AuditSummary;
  findings: AuditFinding[];
  regressionSuite: RegressionSuiteReport;
  dataCardMarkdown: string;
  limitations: string[];
}

export interface AuditRequestPayload {
  rows: DatasetRow[];
  metadata: DatasetMetadata;
}
