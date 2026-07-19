import { FORBIDDEN_KEYS, LIMITS } from "./constants";
import type { DatasetRow, DatasetScalar } from "./types";

export interface ParsedDataset {
  rows: DatasetRow[];
  columns: string[];
  format: "CSV" | "JSON";
  bytes: number;
}

function textBytes(value: string) {
  return new TextEncoder().encode(value).byteLength;
}

function normalizeHeader(value: string, index: number) {
  const header = value.replace(/^\uFEFF/, "").trim();
  if (!header) {
    throw new Error(`Column ${index + 1} has no name.`);
  }
  if (header.length > LIMITS.keyCharacters) {
    throw new Error(`Column "${header.slice(0, 24)}…" is too long.`);
  }
  if (FORBIDDEN_KEYS.has(header.toLowerCase())) {
    throw new Error(`Column "${header}" is not allowed.`);
  }
  return header;
}

function validateShape(rows: DatasetRow[]) {
  if (rows.length === 0) {
    throw new Error("The dataset has no data rows.");
  }
  if (rows.length > LIMITS.rows) {
    throw new Error(`The dataset exceeds the ${LIMITS.rows.toLocaleString()} row limit.`);
  }

  const columns = Object.keys(rows[0]);
  if (columns.length === 0) {
    throw new Error("Dataset rows must contain at least one column.");
  }
  if (columns.length > LIMITS.columns) {
    throw new Error(`The dataset exceeds the ${LIMITS.columns} column limit.`);
  }
  const expectedSchema = columns.map((key) => key.toLowerCase()).sort();
  for (const [rowIndex, row] of rows.entries()) {
    const rowKeys = Object.keys(row);
    if (rowKeys.length === 0) {
      throw new Error(`Row ${rowIndex + 1} must contain at least one column.`);
    }
    const rowSchema = rowKeys.map((key) => key.toLowerCase()).sort();
    if (
      rowSchema.length !== expectedSchema.length ||
      rowSchema.some((key, index) => key !== expectedSchema[index])
    ) {
      throw new Error(`Row ${rowIndex + 1} does not match the dataset schema.`);
    }
    for (const [key, value] of Object.entries(row)) {
      if (typeof value === "string" && value.length > LIMITS.cellCharacters) {
        throw new Error(`A value in "${key}" exceeds ${LIMITS.cellCharacters.toLocaleString()} characters.`);
      }
    }
  }
  return columns;
}

function parseCsvGrid(input: string) {
  const grid: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (quoted) {
      if (char === '"') {
        if (input[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += char;
      }
      continue;
    }

    if (char === '"') {
      if (cell.length !== 0) {
        throw new Error("A quoted CSV value must begin at the start of a cell.");
      }
      quoted = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell.replace(/\r$/, ""));
      grid.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }

  if (quoted) {
    throw new Error("The CSV contains an unterminated quoted value.");
  }

  row.push(cell.replace(/\r$/, ""));
  if (row.some((value) => value.length > 0) || grid.length === 0) {
    grid.push(row);
  }
  return grid.filter((values) => values.some((value) => value.trim() !== ""));
}

export function parseCsv(input: string): ParsedDataset {
  const bytes = textBytes(input);
  if (bytes > LIMITS.fileBytes) {
    throw new Error(`The file exceeds the ${(LIMITS.fileBytes / 1_000_000).toFixed(0)} MB limit.`);
  }

  const grid = parseCsvGrid(input);
  if (grid.length < 2) {
    throw new Error("CSV files need one header row and at least one data row.");
  }

  const headers = grid[0].map(normalizeHeader);
  if (headers.length > LIMITS.columns) {
    throw new Error(`The dataset exceeds the ${LIMITS.columns} column limit.`);
  }
  const lowerHeaders = headers.map((header) => header.toLowerCase());
  if (new Set(lowerHeaders).size !== headers.length) {
    throw new Error("CSV column names must be unique, ignoring letter case.");
  }

  const rows: DatasetRow[] = grid.slice(1).map((values, rowIndex) => {
    if (values.length > headers.length) {
      throw new Error(`Row ${rowIndex + 2} has more values than the header.`);
    }
    const row: DatasetRow = {};
    headers.forEach((header, columnIndex) => {
      const value = values[columnIndex] ?? "";
      if (value.length > LIMITS.cellCharacters) {
        throw new Error(`A value in row ${rowIndex + 2} exceeds ${LIMITS.cellCharacters.toLocaleString()} characters.`);
      }
      row[header] = value;
    });
    return row;
  });

  return { rows, columns: validateShape(rows), format: "CSV", bytes };
}

function scalarValue(value: unknown, key: string, rowIndex: number): DatasetScalar {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    if (typeof value === "number" && !Number.isFinite(value)) {
      throw new Error(`Row ${rowIndex + 1}, column "${key}" contains a non-finite number.`);
    }
    if (typeof value === "string" && value.length > LIMITS.cellCharacters) {
      throw new Error(`A value in row ${rowIndex + 1}, column "${key}" is too long.`);
    }
    return value;
  }
  throw new Error(`Row ${rowIndex + 1}, column "${key}" must contain a scalar value.`);
}

export function parseJson(input: string): ParsedDataset {
  const bytes = textBytes(input);
  if (bytes > LIMITS.fileBytes) {
    throw new Error(`The file exceeds the ${(LIMITS.fileBytes / 1_000_000).toFixed(0)} MB limit.`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch {
    throw new Error("The JSON file is not valid JSON.");
  }

  const candidate =
    Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === "object" && "rows" in parsed
        ? (parsed as { rows?: unknown }).rows
        : null;

  if (!Array.isArray(candidate)) {
    throw new Error('JSON must be an array of records or an object with a "rows" array.');
  }

  let schema: Array<{ canonical: string; lower: string }> | null = null;
  const rows: DatasetRow[] = candidate.map((value, rowIndex) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(`Row ${rowIndex + 1} must be an object.`);
    }
    const cells = new Map<string, { key: string; value: unknown }>();
    for (const [rawKey, rawValue] of Object.entries(value)) {
      const key = normalizeHeader(rawKey, cells.size);
      const lower = key.toLowerCase();
      if (cells.has(lower)) {
        throw new Error(`Row ${rowIndex + 1} contains colliding column names after normalization.`);
      }
      cells.set(lower, { key, value: rawValue });
    }
    if (cells.size === 0) {
      throw new Error(`Row ${rowIndex + 1} must contain at least one column.`);
    }
    if (!schema) {
      schema = [...cells].map(([lower, cell]) => ({ lower, canonical: cell.key }));
    } else if (
      cells.size !== schema.length ||
      schema.some(({ lower }) => !cells.has(lower))
    ) {
      throw new Error(`Row ${rowIndex + 1} does not match the dataset schema.`);
    }
    const row: DatasetRow = {};
    for (const { canonical, lower } of schema) {
      const cell = cells.get(lower);
      if (!cell) throw new Error(`Row ${rowIndex + 1} does not match the dataset schema.`);
      row[canonical] = scalarValue(cell.value, canonical, rowIndex);
    }
    return row;
  });

  return { rows, columns: validateShape(rows), format: "JSON", bytes };
}

export function parseDatasetText(filename: string, input: string) {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".csv")) return parseCsv(input);
  if (lower.endsWith(".json")) return parseJson(input);
  throw new Error("Choose a .csv or .json file.");
}
