# Architecture

## Design objective

DataTrust Gate is a deliberately bounded pre-release inspection service. It turns a small, flat dataset candidate into an explainable review artifact without adding upload storage, a hosted model, or an untestable overall “quality score.”

## Runtime boundary

1. `lib/dataset-parser.ts` parses CSV or JSON in the browser and rejects unsupported shape, nesting, size, row, column, key, and cell limits. Empty rows, inconsistent schemas, and trim/case-normalised key collisions are rejected.
2. `app/AuditWorkbench.tsx` retains parsed rows only in component memory. It displays schema and counts, not raw row previews.
3. The browser sends parsed rows and release metadata to the same-origin `POST /api/audit` route. The route copies chunks into one fixed 1.5 MB byte buffer and stops reading at the cap; it does not retain one object or decoded string per incoming chunk.
4. The route independently revalidates every boundary. Client validation is not trusted.
5. `lib/audit-engine.ts` runs deterministic detectors. Its serialised result never returns raw row scalar values: identifiers are redacted, split values are withheld, and label distributions use neutral category tokens.
6. `lib/report.ts` creates dataset, configuration, and report SHA-256 values plus a Markdown data card. Operator-supplied text is rendered inert by entity-encoding all ASCII punctuation, including Markdown controls and URL delimiters.
7. `lib/regression-suite.ts` runs fixed synthetic fixtures with separately declared expected findings and adds regression status to the report.

No runtime persistence binding is declared. The route contains no logging statement and no outbound fetch.

## Detector contracts

### Identifier-pattern detector

Scans string cells for email addresses, Malaysian mobile-number shapes, Malaysian NRIC-like shapes, and valid IPv4 shapes. Safe non-negative integer cells are also checked for tightly constrained Malaysian mobile and 12-digit NRIC-like shapes; ordinary scores and floating-point values are ignored. Each finding includes a category, row, column, and fixed redaction token.

This is pattern detection—not identity verification, sensitivity classification, anonymisation, or proof that a match belongs to a real person.

### Exact duplicate detector

Normalises strings with Unicode NFKC, trims, collapses whitespace, lowercases values, sorts keys, and hashes the resulting record representation. The configured identifier column is excluded. Repeated fingerprints become review pairs. Pair counts are computed exactly with `n × (n - 1) / 2`; serialised evidence is capped at six samples.

### Near-duplicate detector

Creates token sets from string feature values after excluding the configured ID, split, and label columns. Tokenisation stops after 64 token matches per row. Rows with fewer than five retained tokens are skipped. Pairs with at least `0.82` Jaccard similarity are flagged, and at most 50,000 candidate pairs are compared. The report separately exposes the pair count and limit, whether the pair scan was capped, the per-row token limit, and how many rows reached it. No more than six evidence samples are retained. These budgets and the fixed `0.82` threshold are intentionally visible and are not claimed to suit every domain or language.

### Split-leakage detector

Excludes the configured ID and split columns, then finds otherwise identical rows assigned to different split values. Aggregate cross-split pair counts are exact, evidence is capped at six samples, and raw split values are withheld. Related-but-nonidentical groups and entity-level leakage require a domain-specific grouping key and are outside v1.

### Label-conflict detector

Excludes ID, split, and label columns. Identical remaining feature values with more than one normalised label become blocking evidence.

### Imbalance detector

For at least ten rows and two labels, warns when the largest class exceeds `75%` or the smallest falls below `15%`. Counts are accumulated in a prototype-safe `Map`, and the report emits neutral `class-01` category tokens instead of raw label values. The warning does not prescribe resampling and does not measure fairness.

### Governance detector

Treats empty and placeholder-like provenance and license/permission fields as release blockers. It cannot verify whether supplied text is truthful or legally sufficient.

## Hashes

- **Dataset hash:** canonical JSON representation of the bounded rows in their supplied order.
- **Configuration hash:** report schema, release metadata, and detector version identifier.
- **Report hash:** status, dataset/configuration hashes, metadata, summary, findings, fixed regression suite, and limitations. Generation time and rendered Markdown are excluded.
- **Regression input hash:** fixed synthetic fixture definitions only.
- **Regression gold hash:** separately declared expected finding keys.

Hashes support reproducibility, not secrecy. Small or predictable datasets may be susceptible to confirmation attacks.

## Fixed regression suite

A canonical result key includes case ID, detector category, record IDs, and evidence location. Duplicate keys collapse before comparison with the separately declared expected findings.

The suite reports:

- expected findings and matched expected findings;
- unexpected and missed findings;
- the same counts per detector category; and
- clean rows flagged in the clean control.

The suite includes clean-control, single-fault, and compound-fault fixtures. All values are fixed and synthetic. It verifies regression behaviour on known maintained examples; it does not estimate precision, recall, or performance in deployment.

## Failure behaviour

- Malformed, oversized, nested, non-finite, empty-row, schema-inconsistent, normalised-key-colliding, or prototype-sensitive input is rejected before analysis.
- Missing optional label or split configuration disables checks that require that column; the report exposes which columns were inferred.
- JSON parse failures return one fixed malformed-request message and never include engine exception text or body fragments. Schema errors retain row/column context but never echo raw cell content.
- Responses are marked `no-store`.
