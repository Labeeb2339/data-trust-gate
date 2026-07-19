import { FORBIDDEN_KEYS, LIMITS } from "@/lib/constants";
import { createAuditReport } from "@/lib/report";
import type {
  AuditRequestPayload,
  DatasetMetadata,
  DatasetRow,
  DatasetScalar,
} from "@/lib/types";

const RESPONSE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
};

class RequestTooLargeError extends Error {}
class MalformedJsonError extends Error {}
class RequestValidationError extends Error {}

function errorResponse(message: string, status: number) {
  return Response.json({ error: message }, { status, headers: RESPONSE_HEADERS });
}

function isScalar(value: unknown): value is DatasetScalar {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  );
}

function validateRows(value: unknown): DatasetRow[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new RequestValidationError("Provide at least one parsed dataset row.");
  }
  if (value.length > LIMITS.rows) {
    throw new RequestValidationError(`The request exceeds the ${LIMITS.rows.toLocaleString()} row limit.`);
  }

  let schema: Array<{ canonical: string; lower: string }> | null = null;
  return value.map((candidate, rowIndex) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      throw new RequestValidationError(`Row ${rowIndex + 1} must be an object.`);
    }
    const cells = new Map<string, { key: string; value: DatasetScalar }>();
    for (const [rawKey, cell] of Object.entries(candidate)) {
      const key = rawKey.trim();
      const lower = key.toLowerCase();
      if (
        !key ||
        key.length > LIMITS.keyCharacters ||
        FORBIDDEN_KEYS.has(lower)
      ) {
        throw new RequestValidationError(`Row ${rowIndex + 1} contains an invalid column name.`);
      }
      if (cells.has(lower)) {
        throw new RequestValidationError(`Row ${rowIndex + 1} contains colliding column names after normalization.`);
      }
      if (!isScalar(cell)) {
        throw new RequestValidationError(`Row ${rowIndex + 1}, column "${key}" must contain a scalar value.`);
      }
      if (typeof cell === "string" && cell.length > LIMITS.cellCharacters) {
        throw new RequestValidationError(`Row ${rowIndex + 1}, column "${key}" is too long.`);
      }
      cells.set(lower, { key, value: cell });
    }
    if (cells.size === 0) {
      throw new RequestValidationError(`Row ${rowIndex + 1} must contain at least one column.`);
    }
    if (cells.size > LIMITS.columns) {
      throw new RequestValidationError(`The request exceeds the ${LIMITS.columns} column limit.`);
    }
    if (!schema) {
      schema = [...cells].map(([lower, cell]) => ({ lower, canonical: cell.key }));
    } else if (
      cells.size !== schema.length ||
      schema.some(({ lower }) => !cells.has(lower))
    ) {
      throw new RequestValidationError(`Row ${rowIndex + 1} does not match the dataset schema.`);
    }
    const row: DatasetRow = {};
    for (const { canonical, lower } of schema) {
      const cell = cells.get(lower);
      if (!cell) throw new RequestValidationError(`Row ${rowIndex + 1} does not match the dataset schema.`);
      row[canonical] = cell.value;
    }
    return row;
  });
}

async function readBodyBounded(request: Request) {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const buffer = new Uint8Array(LIMITS.requestBytes);
  let bytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      if (chunk.value.byteLength > LIMITS.requestBytes - bytes) {
        await reader.cancel();
        throw new RequestTooLargeError("The audit request is too large.");
      }
      buffer.set(chunk.value, bytes);
      bytes += chunk.value.byteLength;
    }
    return new TextDecoder().decode(buffer.subarray(0, bytes));
  } finally {
    reader.releaseLock();
  }
}

function parseJsonPayload(text: string): Partial<AuditRequestPayload> {
  try {
    return JSON.parse(text) as Partial<AuditRequestPayload>;
  } catch {
    throw new MalformedJsonError("The audit request contains malformed JSON.");
  }
}

function validateMetadata(value: unknown): DatasetMetadata {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RequestValidationError("Dataset metadata is required.");
  }
  const source = value as Record<string, unknown>;
  const keys: (keyof DatasetMetadata)[] = [
    "datasetName",
    "provenance",
    "license",
    "purpose",
    "labelColumn",
    "splitColumn",
    "idColumn",
  ];
  const metadata = {} as DatasetMetadata;
  for (const key of keys) {
    const candidate = source[key] ?? "";
    if (typeof candidate !== "string") throw new RequestValidationError(`Metadata field "${key}" must be text.`);
    if (candidate.length > LIMITS.metadataCharacters) {
      throw new RequestValidationError(`Metadata field "${key}" exceeds ${LIMITS.metadataCharacters} characters.`);
    }
    metadata[key] = candidate.trim();
  }
  return metadata;
}

function validateConfiguredColumns(rows: DatasetRow[], metadata: DatasetMetadata) {
  const columns = new Map(
    [...new Set(rows.flatMap((row) => Object.keys(row)))].map((column) => [
      column.toLowerCase(),
      column,
    ]),
  );
  for (const [label, requested] of [
    ["label", metadata.labelColumn],
    ["split", metadata.splitColumn],
    ["identifier", metadata.idColumn],
  ] as const) {
    if (requested && !columns.has(requested.toLowerCase())) {
      throw new RequestValidationError(`The configured ${label} column does not exist in the submitted rows.`);
    }
  }
}

export async function POST(request: Request) {
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (declaredLength > LIMITS.requestBytes) {
    return errorResponse("The audit request is too large.", 413);
  }

  let text = "";
  try {
    text = await readBodyBounded(request);
    const candidate = parseJsonPayload(text);
    const rows = validateRows(candidate.rows);
    const metadata = validateMetadata(candidate.metadata);
    validateConfiguredColumns(rows, metadata);
    const report = await createAuditReport(rows, metadata);
    return Response.json(report, { headers: RESPONSE_HEADERS });
  } catch (error) {
    if (error instanceof RequestTooLargeError) {
      return errorResponse("The audit request is too large.", 413);
    }
    if (error instanceof MalformedJsonError) {
      return errorResponse("The audit request contains malformed JSON.", 400);
    }
    if (error instanceof RequestValidationError) {
      return errorResponse(error.message, 400);
    }
    return errorResponse("The audit request could not be processed.", 500);
  } finally {
    text = "";
  }
}
