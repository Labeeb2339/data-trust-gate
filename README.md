# DataTrust Gate

**An evidence-led release auditor for bounded AI dataset candidates.**

I built DataTrust Gate to inspect a local CSV or flat JSON file and return a
`BLOCK`, `WARN`, or `PASS` decision with masked evidence, practical remediation,
stable hashes, and downloadable JSON and Markdown data cards.

It is an independent student engineering prototype. It is not affiliated with or endorsed by the Sarawak Artificial Intelligence Centre, MOSTI, NIST, W3C, or the ICO.

## Why this exists

Model evaluation can become unreliable before training starts. Direct identifiers can enter a release, duplicates can overweight examples, related records can cross train/test boundaries, identical features can receive conflicting labels, and usage rights can remain undocumented.

This project makes those risks visible through deterministic, inspectable checks rather than presenting an unexplained “AI quality score.” Its direction is informed by:

- [NIST AI Resource Center](https://airc.nist.gov/) material on operational testing, evaluation, verification, and validation;
- Malaysia's [National Guidelines on AI Governance and Ethics](https://www.mosti.gov.my/wp-content/uploads/2024/09/NATIONAL-GUIDELINES-OF-AIGE-20241118.pdf), particularly its emphasis on privacy safeguards, transparency, reproducibility, and accountability;
- the [W3C Data Quality Vocabulary](https://www.w3.org/TR/vocab-dqv/) approach to expressing data-quality observations and measurements; and
- [ICO pseudonymisation guidance](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/data-sharing/anonymisation/pseudonymisation/), which distinguishes masking or pseudonymisation from anonymisation and notes residual re-identification risk.

“Informed by” does not mean compliant with, certified by, or formally assessed against those sources.

## Implemented checks

| Detector | Decision | Evidence returned |
|---|---|---|
| Email, Malaysian mobile, NRIC-like, and IPv4 patterns | `BLOCK` | Row, column, category, and a redaction marker—never the matched value |
| Exact duplicates after excluding the configured ID | `WARN` | Record pair locations |
| Near duplicates using deterministic token Jaccard similarity | `WARN` | Record pairs and similarity percentage; no source text |
| Identical records crossing configured dataset splits | `BLOCK` | Record pair locations; scalar split values are withheld |
| Identical features with conflicting labels | `BLOCK` | Record group locations and label count |
| Material class imbalance | `WARN` | Largest and smallest observed class share |
| Missing provenance | `BLOCK` | Metadata finding |
| Missing license or documented permission basis | `BLOCK` | Metadata finding |

Regex, rule, and statistical checks can produce both false positives and false negatives. They do not determine consent, ownership, fairness, representativeness, fitness for purpose, or legal compliance.

## Privacy and storage boundary

- The selected file is parsed in the browser. Raw file text is not uploaded as a file or stored by the application.
- Parsed rows remain in React memory until the user clears them, replaces them, navigates away, or closes the page.
- A bounded JSON request is sent only to the same-origin `/api/audit` route. The route copies streamed bytes into one fixed-size buffer and stops reading once the cap is exceeded, so tiny chunk counts cannot amplify retained request memory. The server has no outbound model or analytics call.
- The route holds the request body and parsed rows only for the request lifetime. It does not write them to D1, R2, browser storage, logs, or repository artifacts.
- `.openai/hosting.json` leaves both `d1` and `r2` bindings `null`.
- API responses use `Cache-Control: no-store` and omit every raw row scalar value, not only matched identifiers. Label distributions use neutral category tokens, and split values are withheld from evidence.
- Release metadata is intentionally preserved in the JSON report. In the Markdown card, ASCII punctuation and URL delimiters are entity-encoded so operator text cannot create active links, images, or HTML. Do not put raw rows, personal data, credentials, or secrets in metadata fields.
- A deterministic dataset hash is returned for reproducibility. A hash can still support a confirmation attack against guessable content; it is not anonymisation.

Enforced limits:

| Boundary | Limit |
|---|---:|
| Local file | 1,000,000 bytes |
| API request | 1,500,000 bytes |
| Rows | 1,000 |
| Columns | 40 |
| Column name | 128 characters |
| Scalar cell | 4,096 characters |
| Metadata field | 500 characters |
| Near-duplicate pair comparisons | 50,000 |
| Near-duplicate token matches | 64 per row |

See [docs/PRIVACY.md](docs/PRIVACY.md) for the lifecycle, tested egress paths, and residual risks.

## Fixed detector regression suite

The repository includes fixed synthetic detector-regression fixtures with a clean control, isolated single-fault cases, and a compound-fault case. Expected findings are declared separately from scanner inputs. The suite checks whether maintained examples still trigger the intended rules; it is not a measured accuracy benchmark.

Reproduce it:

```bash
npm run regression
npm run regression -- --json
```

The implementation and expected findings are in [lib/regression-suite.ts](lib/regression-suite.ts); exact assertions are in [tests/audit.test.ts](tests/audit.test.ts).

Current `dtg-fixed-regression-v1` (`1.0.0`) result:

| Field | Value |
|---|---:|
| Expected findings matched | `15 / 15` |
| Unexpected findings | `0` |
| Missed expected findings | `0` |
| Clean rows flagged | `0 / 10` |
| Input artifact SHA-256 | `8540c2419466b995f739d1be59ab6d45fb4236e306a42f25e8c70894a1587560` |
| Gold artifact SHA-256 | `69eb48c4e56818fa636c41a6e83a4effd2c463176df40c5dcad88640d4db4dd4` |

These results describe only the maintained synthetic examples. They are not evidence of precision, recall, field accuracy, robustness on unseen formats, multilingual coverage, or organisational readiness. No deployment acceptance threshold is claimed.

## Run locally

Requirements: Node.js 22.13 or newer.

```bash
npm ci
npm run dev
```

The application contains a “known-defect demo” that uses only synthetic values and intentionally omits provenance and license metadata.

## Verify

```bash
npm run check
```

The check runs ESLint, TypeScript, 16 detector/parser/report unit tests, a production vinext/Cloudflare Worker build, and six server-render/API integration tests. GitHub Actions runs the same command on Node.js 22.

## Architecture

```text
CSV / JSON file
      |
      v
bounded browser parser ---- schema/count display
      |
      | same-origin JSON; parsed rows only
      v
POST /api/audit ---- request validation ---- deterministic detectors
                                              |      |      |
                                              PII   integrity   governance
                                                      |
                                                      v
                    masked findings + hashes + fixed regression suite
                                                      |
                                                      v
                               downloadable JSON / Markdown data card

No D1 · No R2 · No localStorage · No outbound model/API call
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for detector contracts and hashing boundaries.

## Non-goals

- legal, privacy, security, or AI-governance certification;
- automatic release approval without accountable human review;
- detection of every identifier format or sensitive attribute;
- semantic duplicate detection across languages or paraphrases;
- durable uploads, accounts, team workflows, or dataset hosting;
- model training, fairness certification, or downstream performance prediction.

## License

[MIT](LICENSE)
