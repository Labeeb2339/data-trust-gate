import { LIMITS } from "./constants";
import type {
  AuditFinding,
  AuditSummary,
  DatasetMetadata,
  DatasetRow,
  FindingEvidence,
  FindingType,
  GateStatus,
} from "./types";

interface AnalysisResult {
  status: GateStatus;
  findings: AuditFinding[];
  summary: AuditSummary;
}

interface PiiPattern {
  id: "email" | "phone" | "nric" | "ip";
  title: string;
  pluralTitle: string;
  expression: RegExp;
  validate?: (match: string) => boolean;
  validateNumeric?: (digits: string) => boolean;
}

function plausibleNricDate(value: string) {
  const digits = value.replace(/-/gu, "");
  if (!/^\d{12}$/u.test(digits)) return false;
  const month = Number(digits.slice(2, 4));
  const day = Number(digits.slice(4, 6));
  return month >= 1 && month <= 12 && day >= 1 && day <= 31;
}

const PII_PATTERNS: PiiPattern[] = [
  {
    id: "email",
    title: "email address",
    pluralTitle: "email addresses",
    expression: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu,
  },
  {
    id: "phone",
    title: "Malaysian phone number",
    pluralTitle: "Malaysian phone numbers",
    expression: /(?:\+?60|0)[\s-]?1[0-46-9](?:[\s-]?\d){7,8}\b/gu,
    validateNumeric: (digits) => /^601[0-46-9]\d{7,8}$/u.test(digits),
  },
  {
    id: "nric",
    title: "Malaysian NRIC-like value",
    pluralTitle: "Malaysian NRIC-like values",
    expression: /\b\d{6}-?\d{2}-?\d{4}\b/gu,
    validate: plausibleNricDate,
    validateNumeric: plausibleNricDate,
  },
  {
    id: "ip",
    title: "IPv4 address",
    pluralTitle: "IPv4 addresses",
    expression: /\b(?:\d{1,3}\.){3}\d{1,3}\b/gu,
    validate: (match) => match.split(".").every((part) => Number(part) <= 255),
  },
];

const LABEL_CANDIDATES = ["label", "target", "class", "outcome", "category"];
const SPLIT_CANDIDATES = ["split", "set", "partition", "fold"];
const ID_CANDIDATES = ["id", "record_id", "row_id", "uuid"];

function normalizedScalar(value: DatasetRow[string]) {
  if (value === null) return "null";
  if (typeof value === "string") {
    return value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();
  }
  return String(value).toLowerCase();
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort((left, right) => left.localeCompare(right))
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
}

function canonicalRow(row: DatasetRow, excluded: Set<string>) {
  const normalized: Record<string, string> = {};
  for (const key of Object.keys(row).sort((left, right) => left.localeCompare(right))) {
    if (!excluded.has(key)) normalized[key] = normalizedScalar(row[key]);
  }
  return stableStringify(normalized);
}

function inferColumn(
  columns: string[],
  requested: string,
  candidates: string[],
) {
  const byLower = new Map(columns.map((column) => [column.toLowerCase(), column]));
  if (requested.trim()) return byLower.get(requested.trim().toLowerCase()) ?? null;
  for (const candidate of candidates) {
    const match = byLower.get(candidate);
    if (match) return match;
  }
  return null;
}

function evidenceSlice(evidence: FindingEvidence[]) {
  return evidence.slice(0, LIMITS.evidencePerFinding);
}

function retainEvidence(evidence: FindingEvidence[], item: FindingEvidence) {
  if (evidence.length < LIMITS.evidencePerFinding) evidence.push(item);
}

function countStringMatches(value: string, pattern: PiiPattern) {
  pattern.expression.lastIndex = 0;
  let count = 0;
  for (const match of value.matchAll(pattern.expression)) {
    if (!pattern.validate || pattern.validate(match[0])) count += 1;
  }
  return count;
}

function countScalarMatches(value: DatasetRow[string], pattern: PiiPattern) {
  if (typeof value === "string") return countStringMatches(value, pattern);
  if (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    pattern.validateNumeric
  ) {
    return pattern.validateNumeric(String(value)) ? 1 : 0;
  }
  return 0;
}

function finding(
  id: string,
  type: FindingType,
  severity: "block" | "warn",
  title: string,
  summary: string,
  evidence: FindingEvidence[],
  remediation: string,
  count = evidence.length,
): AuditFinding {
  return {
    id,
    type,
    severity,
    title,
    summary,
    count,
    evidence: evidenceSlice(evidence),
    remediation,
  };
}

function tokenSet(row: DatasetRow, excluded: Set<string>) {
  const tokens = new Set<string>();
  let matches = 0;
  let atLimit = false;

  outer: for (const [key, value] of Object.entries(row)) {
    if (excluded.has(key) || typeof value !== "string") continue;
    const text = value.normalize("NFKC").toLowerCase();
    for (const match of text.matchAll(/[\p{L}\p{N}]+/gu)) {
      matches += 1;
      tokens.add(match[0]);
      if (matches >= LIMITS.nearDuplicateTokenMatchesPerRow) {
        atLimit = true;
        break outer;
      }
    }
  }

  return { tokens, atLimit };
}

function jaccard(left: Set<string>, right: Set<string>) {
  if (left.size === 0 || right.size === 0) return 0;
  let intersection = 0;
  for (const token of left) if (right.has(token)) intersection += 1;
  return intersection / (left.size + right.size - intersection);
}

function emptyLike(value: string) {
  return !value.trim() || /^(unknown|n\/?a|none|tbd|unspecified)$/iu.test(value.trim());
}

export function analyzeDataset(
  rows: DatasetRow[],
  metadata: DatasetMetadata,
): AnalysisResult {
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const labelColumn = inferColumn(columns, metadata.labelColumn, LABEL_CANDIDATES);
  const splitColumn = inferColumn(columns, metadata.splitColumn, SPLIT_CANDIDATES);
  const idColumn = inferColumn(columns, metadata.idColumn, ID_CANDIDATES);
  const findings: AuditFinding[] = [];
  const piiCellLocations = new Set<string>();

  const piiByType = new Map<string, { count: number; evidence: FindingEvidence[] }>();
  rows.forEach((row, rowIndex) => {
    for (const [column, value] of Object.entries(row)) {
      for (const pattern of PII_PATTERNS) {
        const matches = countScalarMatches(value, pattern);
        if (matches === 0) continue;
        piiCellLocations.add(`${rowIndex + 1}:${column}`);
        const accumulator = piiByType.get(pattern.id) ?? { count: 0, evidence: [] };
        accumulator.count += 1;
        retainEvidence(accumulator.evidence, {
          key: `pii:${pattern.id}:${rowIndex + 1}:${column}`,
          row: rowIndex + 1,
          column,
          maskedValue: `[${pattern.id} redacted]`,
          detail: `${matches} matching pattern${matches === 1 ? "" : "s"} detected in this cell; the scalar value is not returned.`,
        });
        piiByType.set(pattern.id, accumulator);
      }
    }
  });

  for (const pattern of PII_PATTERNS) {
    const accumulator = piiByType.get(pattern.id);
    if (!accumulator) continue;
    findings.push(
      finding(
        `pii-${pattern.id}`,
        "pii",
        "block",
        `Potential ${pattern.pluralTitle}`,
        `${accumulator.count} cell${accumulator.count === 1 ? "" : "s"} matched the ${pattern.title} detector. Evidence is masked in this report.`,
        accumulator.evidence,
        "Remove direct identifiers, replace them with reviewed synthetic or properly governed values, then rerun the gate. Masking in this report does not anonymise the source dataset.",
        accumulator.count,
      ),
    );
  }

  const duplicateExcluded = new Set(idColumn ? [idColumn] : []);
  const duplicateBuckets = new Map<string, number[]>();
  rows.forEach((row, index) => {
    const fingerprint = canonicalRow(row, duplicateExcluded);
    const bucket = duplicateBuckets.get(fingerprint) ?? [];
    bucket.push(index);
    duplicateBuckets.set(fingerprint, bucket);
  });
  const exactEvidence: FindingEvidence[] = [];
  let exactDuplicatePairs = 0;
  for (const bucket of duplicateBuckets.values()) {
    if (bucket.length < 2) continue;
    exactDuplicatePairs += (bucket.length * (bucket.length - 1)) / 2;
    for (let left = 0; left < bucket.length && exactEvidence.length < LIMITS.evidencePerFinding; left += 1) {
      for (
        let right = left + 1;
        right < bucket.length && exactEvidence.length < LIMITS.evidencePerFinding;
        right += 1
      ) {
        retainEvidence(exactEvidence, {
          key: `exact:${bucket[left] + 1}:${bucket[right] + 1}`,
          row: bucket[left] + 1,
          otherRow: bucket[right] + 1,
          detail: "Rows are identical after excluding the configured identifier column.",
        });
      }
    }
  }
  if (exactDuplicatePairs > 0) {
    findings.push(
      finding(
        "exact-duplicates",
        "exact-duplicate",
        "warn",
        "Exact duplicate records",
        `${exactDuplicatePairs} duplicate pair${exactDuplicatePairs === 1 ? "" : "s"} can overweight repeated examples.`,
        exactEvidence,
        "Confirm whether repeated records are legitimate observations. Otherwise deduplicate before splitting or training.",
        exactDuplicatePairs,
      ),
    );
  }

  const featureExcluded = new Set(
    [idColumn, splitColumn, labelColumn].filter((value): value is string => Boolean(value)),
  );
  const featureFingerprints = rows.map((row) => canonicalRow(row, featureExcluded));
  const tokenRows = rows.map((row) => tokenSet(row, featureExcluded));
  const tokens = tokenRows.map((entry) => entry.tokens);
  const nearDuplicateRowsAtTokenLimit = tokenRows.filter((entry) => entry.atLimit).length;
  const nearEvidence: FindingEvidence[] = [];
  let nearDuplicatePairs = 0;
  let nearDuplicateComparisons = 0;
  let nearDuplicatePairScanCapped = false;
  nearScan: for (let left = 0; left < rows.length; left += 1) {
    if (tokens[left].size < 5) continue;
    for (let right = left + 1; right < rows.length; right += 1) {
      if (nearDuplicateComparisons >= LIMITS.pairComparisons) {
        nearDuplicatePairScanCapped = true;
        break nearScan;
      }
      nearDuplicateComparisons += 1;
      if (featureFingerprints[left] === featureFingerprints[right]) continue;
      const sizeRatio = Math.min(tokens[left].size, tokens[right].size) /
        Math.max(tokens[left].size, tokens[right].size);
      if (sizeRatio < 0.75) continue;
      const similarity = jaccard(tokens[left], tokens[right]);
      if (similarity < 0.82) continue;
      nearDuplicatePairs += 1;
      retainEvidence(nearEvidence, {
        key: `near:${left + 1}:${right + 1}`,
        row: left + 1,
        otherRow: right + 1,
        detail: `Token similarity ${(similarity * 100).toFixed(0)}%; source text is not included.`,
      });
    }
  }
  if (nearDuplicatePairs > 0) {
    findings.push(
      finding(
        "near-duplicates",
        "near-duplicate",
        "warn",
        "Near-duplicate records",
        `${nearDuplicatePairs} highly similar pair${nearDuplicatePairs === 1 ? "" : "s"} may reduce dataset diversity${nearDuplicatePairScanCapped || nearDuplicateRowsAtTokenLimit > 0 ? " within the configured comparison and token work budgets" : ""}.`,
        nearEvidence,
        "Review these pairs, define a domain-appropriate similarity threshold, and keep only meaningful variants.",
        nearDuplicatePairs,
      ),
    );
  }

  const leakageEvidence: FindingEvidence[] = [];
  let leakagePairs = 0;
  if (splitColumn) {
    const splitExcluded = new Set(
      [idColumn, splitColumn].filter((value): value is string => Boolean(value)),
    );
    const groups = new Map<string, number[]>();
    rows.forEach((row, index) => {
      const fingerprint = canonicalRow(row, splitExcluded);
      const bucket = groups.get(fingerprint) ?? [];
      bucket.push(index);
      groups.set(fingerprint, bucket);
    });
    for (const bucket of groups.values()) {
      const splitCounts = new Map<string, { count: number; firstIndex: number }>();
      let seen = 0;
      for (const rowIndex of bucket) {
        const rawSplit = rows[rowIndex][splitColumn];
        if (rawSplit === null || normalizedScalar(rawSplit) === "") continue;
        const splitToken = normalizedScalar(rawSplit);
        const sameSplit = splitCounts.get(splitToken);
        leakagePairs += seen - (sameSplit?.count ?? 0);

        if (leakageEvidence.length < LIMITS.evidencePerFinding) {
          for (const [otherToken, other] of splitCounts) {
            if (otherToken === splitToken) continue;
            retainEvidence(leakageEvidence, {
              key: `leakage:${other.firstIndex + 1}:${rowIndex + 1}`,
              row: other.firstIndex + 1,
              otherRow: rowIndex + 1,
              column: splitColumn,
              detail: "The same example appears in more than one split category; scalar category values are withheld.",
            });
            if (leakageEvidence.length >= LIMITS.evidencePerFinding) break;
          }
        }
        splitCounts.set(splitToken, {
          count: (sameSplit?.count ?? 0) + 1,
          firstIndex: sameSplit?.firstIndex ?? rowIndex,
        });
        seen += 1;
      }
    }
  }
  if (leakagePairs > 0) {
    findings.push(
      finding(
        "split-leakage",
        "split-leakage",
        "block",
        "Train/test split leakage",
        `${leakagePairs} identical pair${leakagePairs === 1 ? " crosses" : "s cross"} dataset splits.`,
        leakageEvidence,
        "Group duplicates before splitting, regenerate the split with a fixed seed, and keep related records in one partition.",
        leakagePairs,
      ),
    );
  }

  const conflictEvidence: FindingEvidence[] = [];
  let conflictingGroups = 0;
  if (labelColumn) {
    const groups = new Map<string, number[]>();
    rows.forEach((row, index) => {
      const fingerprint = canonicalRow(row, featureExcluded);
      const bucket = groups.get(fingerprint) ?? [];
      bucket.push(index);
      groups.set(fingerprint, bucket);
    });
    for (const bucket of groups.values()) {
      const labels = new Set(bucket.map((index) => normalizedScalar(rows[index][labelColumn])));
      if (labels.size < 2) continue;
      conflictingGroups += 1;
      const firstIndex = bucket[0];
      const secondIndex = bucket.find(
        (index) => normalizedScalar(rows[index][labelColumn]) !== normalizedScalar(rows[firstIndex][labelColumn]),
      );
      retainEvidence(conflictEvidence, {
        key: `conflict:${firstIndex + 1}:${(secondIndex ?? firstIndex) + 1}`,
        row: firstIndex + 1,
        otherRow: (secondIndex ?? firstIndex) + 1,
        column: labelColumn,
        detail: `${labels.size} different labels are assigned to the same feature values.`,
      });
    }
  }
  if (conflictingGroups > 0) {
    findings.push(
      finding(
        "conflicting-labels",
        "conflicting-label",
        "block",
        "Conflicting labels",
        `${conflictingGroups} feature group${conflictingGroups === 1 ? " has" : "s have"} inconsistent labels.`,
        conflictEvidence,
        "Review the annotation rule and adjudicate conflicts before model training. Preserve the decision in dataset documentation.",
        conflictingGroups,
      ),
    );
  }

  const labelCounts = new Map<string, number>();
  let labelDistribution: AuditSummary["labelDistribution"] = [];
  if (labelColumn) {
    for (const row of rows) {
      const label = normalizedScalar(row[labelColumn]) || "(empty)";
      labelCounts.set(label, (labelCounts.get(label) ?? 0) + 1);
    }
    labelDistribution = [...labelCounts.values()].map((count, index) => ({
      category: `class-${String(index + 1).padStart(2, "0")}`,
      count,
    }));
    const counts = [...labelCounts.values()];
    if (rows.length >= 10 && counts.length >= 2) {
      const largest = Math.max(...counts);
      const smallest = Math.min(...counts);
      const majorityShare = largest / rows.length;
      const minorityShare = smallest / rows.length;
      if (majorityShare > 0.75 || minorityShare < 0.15) {
        const evidence = [{
          key: "imbalance:label-distribution",
          column: labelColumn,
          detail: `Largest class ${(majorityShare * 100).toFixed(0)}%; smallest class ${(minorityShare * 100).toFixed(0)}%.`,
        }];
        findings.push(
          finding(
            "class-imbalance",
            "class-imbalance",
            "warn",
            "Class imbalance",
            "The observed label distribution may hide minority-class performance.",
            evidence,
            "Use stratified evaluation and report per-class precision, recall, and support. Rebalance only with a documented reason.",
          ),
        );
      }
    }
  }

  if (emptyLike(metadata.provenance)) {
    findings.push(
      finding(
        "missing-provenance",
        "missing-provenance",
        "block",
        "Missing provenance",
        "The release metadata does not identify where the data came from.",
        [{ key: "metadata:provenance", detail: "No usable provenance statement was supplied." }],
        "Record the source, collection method, date range, transformations, and accountable data custodian.",
      ),
    );
  }

  if (emptyLike(metadata.license)) {
    findings.push(
      finding(
        "missing-license",
        "missing-license",
        "block",
        "Missing license or usage basis",
        "The release metadata does not state a license or documented permission basis.",
        [{ key: "metadata:license", detail: "No usable license or usage basis was supplied." }],
        "Confirm redistribution and model-training rights with the data owner, then record the applicable license or approval.",
      ),
    );
  }

  const blockCount = findings.filter((item) => item.severity === "block").length;
  const warningCount = findings.filter((item) => item.severity === "warn").length;
  const status: GateStatus = blockCount > 0 ? "BLOCK" : warningCount > 0 ? "WARN" : "PASS";

  return {
    status,
    findings,
    summary: {
      rowCount: rows.length,
      columnCount: columns.length,
      blockCount,
      warningCount,
      piiCellCount: piiCellLocations.size,
      exactDuplicatePairs,
      nearDuplicatePairs,
      leakagePairs,
      conflictingGroups,
      labelDistribution,
      nearDuplicateComparisons,
      nearDuplicateComparisonLimit: LIMITS.pairComparisons,
      nearDuplicatePairScanCapped,
      nearDuplicateTokenLimit: LIMITS.nearDuplicateTokenMatchesPerRow,
      nearDuplicateRowsAtTokenLimit,
      inferredColumns: {
        label: labelColumn,
        split: splitColumn,
        id: idColumn,
      },
    },
  };
}
