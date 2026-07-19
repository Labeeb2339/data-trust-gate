# Privacy and data lifecycle

## Raw-data lifetime

### Browser

The browser reads the selected file into a temporary JavaScript string, parses it, and then retains only parsed scalar rows in React component memory. Rows remain until the user clears or replaces the dataset, navigates away, reloads, or closes the page. The application does not place rows in `localStorage`, `sessionStorage`, IndexedDB, cookies, service-worker caches, or a client log.

### Same-origin request

When the user chooses **Run release gate**, the browser serialises the bounded rows and metadata into one same-origin JSON request to `/api/audit`. The route reads the body incrementally into one preallocated 1.5 MB byte buffer and cancels the reader as soon as the cap is exceeded. It does not retain a separate decoded string or array entry for each incoming chunk, so a large number of tiny chunks cannot amplify retained application memory. This is the only dataset-bearing network path implemented by the application.

### Server

The route holds the fixed byte buffer, bounded decoded request text, parsed payload, detector state, and generated report in memory for the request lifetime. The request-text reference is cleared in a `finally` block. Garbage-collection timing remains controlled by the JavaScript runtime.

There is no D1 or R2 binding, upload directory, queue, analytics SDK, external model call, or application log statement. The API response uses `Cache-Control: no-store`.

Hosting and network infrastructure can have access logs or operational telemetry outside this repository's application code. This prototype does not claim control over an operator's browser extensions, reverse proxy, endpoint security software, or hosting-provider infrastructure.

## Returned evidence

PII-pattern results return:

- detector category;
- one-based row number;
- column name;
- fixed text such as `[email redacted]`; and
- count and remediation.

The matched value and surrounding source text are not returned. The serialised result omits every raw row scalar value, including labels and dataset split names. Duplicate, leakage, and conflict findings return row locations and aggregate counts; label distributions use neutral `class-01`-style category tokens. Evidence samples are bounded even when aggregate counts are larger.

Release metadata is different: project, owner, purpose, provenance, and license/permission fields are deliberately preserved in the JSON report. The Markdown card entity-encodes all ASCII punctuation and URL delimiters so the same content renders as inert text rather than active images, links, or HTML. Operators must not place raw rows, personal data, passwords, API keys, access tokens, or other secrets in those metadata fields.

Masking report evidence does not anonymise or pseudonymise the uploaded source dataset. The original values still exist in browser and request memory during the audit, and re-identification risk can remain in unflagged quasi-identifiers.

## Hash residual risk

The dataset SHA-256 is deterministic. It supports repeatability but can allow confirmation of a guessed dataset or small candidate set. Do not publish report hashes when even confirming possession of a dataset would be sensitive.

## Tested egress and storage assertions

The automated integration suite verifies that:

- the browser-facing product renders without the starter preview;
- the same-origin API returns `Cache-Control: no-store`;
- planted email, label, and split values are absent from the serialized response;
- operator metadata cannot create active Markdown images, links, or HTML;
- masked evidence is returned;
- empty rows, normalised key collisions, inconsistent schemas, and nested input are rejected;
- a malformed-JSON canary is absent from the fixed error response; and
- a streamed request with 50,000 one-byte chunks receives `413` at the byte cap without per-chunk retained strings.

Repository checks also keep runtime storage bindings `null`. Source review should confirm that future changes do not introduce outbound `fetch`, raw-input logging, analytics, persistence, or service-worker caching. The test suite cannot prove the behaviour of browser extensions, proxies, platform telemetry, or modified deployments.

## False positives and false negatives

- Regex patterns may flag synthetic IDs or technical strings that resemble PII.
- Unusual formatting, obfuscation, international numbers, IPv6, names, addresses, and domain-specific identifiers can be missed.
- Token Jaccard similarity can miss paraphrases and can overflag formulaic records.
- Exact fingerprint checks cannot detect entity-level leakage without a correct grouping identifier.
- Metadata checks cannot verify truth, consent, contractual rights, or legal sufficiency.
- Distribution thresholds do not measure subgroup fairness or representativeness.

## Operator responsibilities

Use synthetic or appropriately governed data during development. Before any real release, involve the accountable data custodian and appropriate privacy, legal, security, and domain reviewers. DataTrust Gate is a review aid, not a legal-compliance engine or certification.
