import { parseJson, type ParsedDataset } from "./dataset-parser";
import type { DatasetMetadata, DatasetRow } from "./types";

const fillerRows: DatasetRow[] = Array.from({ length: 16 }, (_, index) => ({
  id: `S-${String(index + 13).padStart(3, "0")}`,
  observation: `marker_${index + 1} zone_${(index % 4) + 1} sample_${100 + index}`,
  score: 0.41 + index * 0.02,
  label: index === 15 ? "review" : "clear",
  split: index % 5 === 0 ? "test" : "train",
}));

const seededDemoSourceRows: DatasetRow[] = [
  {
    id: "S-001",
    observation: "Synthetic intake record",
    contact: "amira.student@example.com",
    label: "clear",
    split: "train",
  },
  {
    id: "S-002",
    observation: "Synthetic callback record",
    contact: "+60 12-345 6789",
    label: "clear",
    split: "train",
  },
  {
    id: "S-003",
    observation: "Synthetic identity record",
    identity: "900101-13-5678",
    label: "clear",
    split: "train",
  },
  {
    id: "S-004",
    observation: "Synthetic network record",
    source_ip: "192.0.2.44",
    label: "clear",
    split: "train",
  },
  {
    id: "S-005",
    observation: "sensor_alpha sector_north reading_42",
    score: 0.42,
    label: "clear",
    split: "train",
  },
  {
    id: "S-006",
    observation: "sensor_alpha sector_north reading_42",
    score: 0.42,
    label: "clear",
    split: "train",
  },
  {
    id: "S-007",
    observation:
      "forest canopy survey camera records hornbill flight near river ridge during dry season",
    label: "clear",
    split: "train",
  },
  {
    id: "S-008",
    observation:
      "forest canopy survey camera records hornbill flight near river ridge during wet season",
    label: "clear",
    split: "train",
  },
  {
    id: "S-009",
    observation: "paddy_plot_delta moisture_67 survey_2026",
    score: 0.67,
    label: "review",
    split: "train",
  },
  {
    id: "S-010",
    observation: "paddy_plot_delta moisture_67 survey_2026",
    score: 0.67,
    label: "review",
    split: "test",
  },
  {
    id: "S-011",
    observation: "canopy_tile_kilo index_031 date_0718",
    score: 0.31,
    label: "clear",
    split: "train",
  },
  {
    id: "S-012",
    observation: "canopy_tile_kilo index_031 date_0718",
    score: 0.31,
    label: "review",
    split: "train",
  },
  ...fillerRows,
];

const seededDemoColumns = [
  ...new Set(seededDemoSourceRows.flatMap((row) => Object.keys(row))),
];

export const SEEDED_DEMO_ROWS: DatasetRow[] = seededDemoSourceRows.map((row) =>
  Object.fromEntries(
    seededDemoColumns.map((column) => [column, row[column] ?? null]),
  ),
);

export function parseSeededDemoDataset(): ParsedDataset {
  return parseJson(JSON.stringify(SEEDED_DEMO_ROWS));
}

export const SEEDED_DEMO_METADATA: DatasetMetadata = {
  datasetName: "Synthetic release candidate 07",
  provenance: "",
  license: "",
  purpose: "Demonstrate a release gate with deliberately planted defects.",
  labelColumn: "label",
  splitColumn: "split",
  idColumn: "id",
};

export const SEEDED_DEMO_DESCRIPTION =
  "28 synthetic rows with deliberately planted identifiers, duplicate patterns, split leakage, label conflict, imbalance, and missing governance metadata.";
