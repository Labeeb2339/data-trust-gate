import assert from "node:assert/strict";
import test from "node:test";
import { parseCsv, parseDatasetText, parseJson } from "../lib/dataset-parser";

test("CSV parser handles quotes, commas, escaped quotes, and CRLF", () => {
  const parsed = parseCsv(
    'id,text,label\r\n1,"river, ridge",clear\r\n2,"camera said ""ready""",review\r\n',
  );
  assert.equal(parsed.rows.length, 2);
  assert.equal(parsed.rows[0].text, "river, ridge");
  assert.equal(parsed.rows[1].text, 'camera said "ready"');
  assert.deepEqual(parsed.columns, ["id", "text", "label"]);
});

test("JSON parser accepts a rows envelope and preserves scalar types", () => {
  const parsed = parseJson('{"rows":[{"id":1,"active":true,"score":0.4,"note":null}]}');
  assert.equal(parsed.rows[0].id, 1);
  assert.equal(parsed.rows[0].active, true);
  assert.equal(parsed.rows[0].note, null);
});

test("parsers reject nested values and unsupported extensions", () => {
  assert.throws(() => parseJson('[{"nested":{"value":1}}]'), /scalar value/);
  assert.throws(() => parseDatasetText("records.xlsx", "data"), /\.csv or \.json/);
});

test("CSV parser rejects duplicate case-insensitive headers", () => {
  assert.throws(() => parseCsv("Label,label\na,b"), /must be unique/);
});

test("JSON parser rejects empty rows and normalized key collisions", () => {
  assert.throws(() => parseJson("[{}]"), /at least one column/);
  assert.throws(
    () => parseJson('[{"label":"a"," Label ":"b"}]'),
    /colliding column names/,
  );
});

test("JSON parser enforces a consistent row schema", () => {
  assert.throws(
    () => parseJson('[{"id":1,"label":"a"},{"id":2,"other":"b"}]'),
    /does not match the dataset schema/,
  );
});
