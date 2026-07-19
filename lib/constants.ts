export const LIMITS = {
  fileBytes: 1_000_000,
  requestBytes: 1_500_000,
  rows: 1_000,
  columns: 40,
  keyCharacters: 128,
  cellCharacters: 4_096,
  metadataCharacters: 500,
  evidencePerFinding: 6,
  pairComparisons: 50_000,
  nearDuplicateTokenMatchesPerRow: 64,
} as const;

export const FORBIDDEN_KEYS = new Set([
  "__proto__",
  "constructor",
  "prototype",
]);

export const EMPTY_METADATA = {
  datasetName: "",
  provenance: "",
  license: "",
  purpose: "",
  labelColumn: "",
  splitColumn: "",
  idColumn: "",
} as const;
