"use client";

import { useRef, useState } from "react";
import { EMPTY_METADATA, LIMITS } from "@/lib/constants";
import { parseDatasetText, type ParsedDataset } from "@/lib/dataset-parser";
import {
  parseSeededDemoDataset,
  SEEDED_DEMO_DESCRIPTION,
  SEEDED_DEMO_METADATA,
} from "@/lib/demo";
import type {
  AuditReport,
  DatasetMetadata,
  DatasetRow,
  GateStatus,
} from "@/lib/types";

interface IntakeState {
  rows: DatasetRow[];
  columns: string[];
  filename: string;
  format: "CSV" | "JSON" | "DEMO";
  bytes: number;
  description: string;
}

const STATUS_COPY: Record<GateStatus, { eyebrow: string; title: string; body: string }> = {
  BLOCK: {
    eyebrow: "Release stopped",
    title: "Resolve blocking evidence before release.",
    body: "The gate found issues that can invalidate evaluation, expose identifiers, or leave usage rights unclear.",
  },
  WARN: {
    eyebrow: "Review required",
    title: "Release only with an accountable review.",
    body: "No blocking detector fired, but the warnings can still affect representativeness or downstream model behaviour.",
  },
  PASS: {
    eyebrow: "Automated gate passed",
    title: "The configured checks found no release blocker.",
    body: "This is not certification. Preserve the report and complete domain, legal, security, and human review.",
  },
};

function humanBytes(bytes: number) {
  if (bytes < 1_000) return `${bytes} B`;
  return `${(bytes / 1_000).toFixed(1)} KB`;
}

function shortHash(hash: string) {
  return `${hash.slice(0, 10)}…${hash.slice(-8)}`;
}

function downloadText(filename: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function metadataFilename(name: string) {
  const stem = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "")
    .slice(0, 48);
  return stem || "dataset";
}

export function AuditWorkbench() {
  const [intake, setIntake] = useState<IntakeState | null>(null);
  const [metadata, setMetadata] = useState<DatasetMetadata>({ ...EMPTY_METADATA });
  const [report, setReport] = useState<AuditReport | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  function setParsedDataset(parsed: ParsedDataset, filename: string) {
    setIntake({
      rows: parsed.rows,
      columns: parsed.columns,
      filename,
      format: parsed.format,
      bytes: parsed.bytes,
      description: "Only schema and counts are shown. Raw cells remain out of the interface.",
    });
    setMetadata((current) => ({
      ...current,
      datasetName: current.datasetName || filename.replace(/\.(csv|json)$/iu, ""),
      labelColumn: current.labelColumn || (parsed.columns.includes("label") ? "label" : ""),
      splitColumn: current.splitColumn || (parsed.columns.includes("split") ? "split" : ""),
      idColumn: current.idColumn || (parsed.columns.includes("id") ? "id" : ""),
    }));
    setReport(null);
    setError("");
  }

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setError("");
    setReport(null);
    if (file.size > LIMITS.fileBytes) {
      setError(`Choose a file smaller than ${(LIMITS.fileBytes / 1_000_000).toFixed(0)} MB.`);
      return;
    }
    try {
      const text = await file.text();
      setParsedDataset(parseDatasetText(file.name, text), file.name);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The file could not be parsed.");
    }
  }

  function loadDemo() {
    const parsed = parseSeededDemoDataset();
    setIntake({
      rows: parsed.rows,
      columns: parsed.columns,
      filename: "fixed-release-candidate.json",
      format: "DEMO",
      bytes: parsed.bytes,
      description: SEEDED_DEMO_DESCRIPTION,
    });
    setMetadata({ ...SEEDED_DEMO_METADATA });
    setReport(null);
    setError("");
    if (fileInput.current) fileInput.current.value = "";
  }

  function clearDataset() {
    setIntake(null);
    setMetadata({ ...EMPTY_METADATA });
    setReport(null);
    setError("");
    if (fileInput.current) fileInput.current.value = "";
  }

  function updateMetadata(key: keyof DatasetMetadata, value: string) {
    setMetadata((current) => ({ ...current, [key]: value }));
    setReport(null);
  }

  async function runAudit() {
    if (!intake) {
      setError("Load the known-defect demo or choose a CSV/JSON dataset first.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/audit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: intake.rows, metadata }),
      });
      const payload = (await response.json()) as unknown;
      if (
        !response.ok ||
        !payload ||
        typeof payload !== "object" ||
        !("schemaVersion" in payload)
      ) {
        const message =
          payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string"
            ? payload.error
            : "The audit failed.";
        throw new Error(message);
      }
      setReport(payload as AuditReport);
      window.requestAnimationFrame(() => {
        document.getElementById("audit-results")?.focus();
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The audit failed.");
    } finally {
      setBusy(false);
    }
  }

  const statusCopy = report ? STATUS_COPY[report.status] : null;
  const filenameStem = metadataFilename(metadata.datasetName || intake?.filename || "dataset");

  return (
    <main>
      <header className="site-header">
        <a className="brand" href="#top" aria-label="DataTrust Gate home">
          <span className="brand-mark" aria-hidden="true"><span /></span>
          <span>DataTrust Gate</span>
        </a>
        <nav aria-label="Page sections">
          <a href="#audit">Audit</a>
          <a href="#regression">Regression</a>
          <a href="#method">Method</a>
        </nav>
        <span className="local-badge">No storage</span>
      </header>

      <section className="hero" id="top">
        <div className="hero-copy">
          <p className="eyebrow">AI dataset release control · v1</p>
          <h1>Find the evidence<br />before the model does.</h1>
          <p className="hero-lede">
            Audit a bounded CSV or JSON release candidate for privacy signals,
            duplication, evaluation leakage, label quality, imbalance, and missing
            governance metadata.
          </p>
          <div className="hero-actions">
            <a className="button primary" href="#audit">Open the gate</a>
            <button className="button secondary" type="button" onClick={loadDemo}>
              Load known-defect demo
            </button>
          </div>
        </div>
        <div className="hero-instrument" aria-label="DataTrust Gate process">
          <p className="instrument-label">Release protocol</p>
          <ol>
            <li><span>01</span><div><strong>Bound</strong><small>1 MB · 1,000 rows · 40 columns</small></div></li>
            <li><span>02</span><div><strong>Inspect</strong><small>Rules + similarity + distribution checks</small></div></li>
            <li><span>03</span><div><strong>Redact</strong><small>Locations returned; matched values withheld</small></div></li>
            <li><span>04</span><div><strong>Prove</strong><small>Hashes + fixed regression suite + data card</small></div></li>
          </ol>
          <div className="instrument-footer">
            <span className="pulse-dot" />
            Ephemeral request path
          </div>
        </div>
      </section>

      <section className="privacy-strip" aria-label="Privacy boundary">
        <strong>Privacy boundary</strong>
        <span>Files are parsed in this browser.</span>
        <span>Only bounded parsed rows are sent for the audit.</span>
        <span>No dataset or report is stored by the application.</span>
      </section>

      <section className="workspace" id="audit">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Audit workspace</p>
            <h2>Prepare a release candidate</h2>
          </div>
          <p>Raw rows are intentionally not previewed. Confirm the schema, record governance metadata, then run the evidence gate.</p>
        </div>

        <div className="workspace-grid">
          <section className="panel intake-panel" aria-labelledby="intake-title">
            <div className="panel-heading">
              <span className="step">01</span>
              <div><h3 id="intake-title">Dataset intake</h3><p>CSV or flat JSON records</p></div>
            </div>

            <label className="dropzone">
              <input
                ref={fileInput}
                type="file"
                accept=".csv,.json,text/csv,application/json"
                onChange={(event) => void handleFile(event.target.files?.[0])}
              />
              <span className="drop-icon" aria-hidden="true">+</span>
              <strong>Choose a local dataset</strong>
              <small>Maximum 1 MB · flat scalar cells only</small>
            </label>

            <div className="divider"><span>or</span></div>
            <button className="button demo-button" type="button" onClick={loadDemo}>
              Load known-defect demo
            </button>

            {intake ? (
              <div className="dataset-summary" aria-live="polite">
                <div className="dataset-file">
                  <span className="file-type">{intake.format}</span>
                  <div><strong>{intake.filename}</strong><small>{intake.description}</small></div>
                  <button type="button" onClick={clearDataset} aria-label="Clear loaded dataset">Clear</button>
                </div>
                <dl>
                  <div><dt>Rows</dt><dd>{intake.rows.length.toLocaleString()}</dd></div>
                  <div><dt>Columns</dt><dd>{intake.columns.length}</dd></div>
                  <div><dt>Payload</dt><dd>{humanBytes(intake.bytes)}</dd></div>
                </dl>
                <div className="schema-list" aria-label="Detected columns">
                  {intake.columns.map((column) => <code key={column}>{column}</code>)}
                </div>
              </div>
            ) : (
              <p className="empty-note">No rows are loaded. The known-defect demo is synthetic and safe to inspect.</p>
            )}
          </section>

          <section className="panel metadata-panel" aria-labelledby="metadata-title">
            <div className="panel-heading">
              <span className="step">02</span>
              <div><h3 id="metadata-title">Release metadata</h3><p>Required for an accountable handoff</p></div>
            </div>

            <div className="form-grid">
              <label className="wide">Dataset name<input value={metadata.datasetName} maxLength={120} onChange={(event) => updateMetadata("datasetName", event.target.value)} placeholder="Paddy field observations — pilot" /></label>
              <label className="wide">Purpose<textarea value={metadata.purpose} maxLength={500} onChange={(event) => updateMetadata("purpose", event.target.value)} placeholder="What decision or model is this dataset intended to support?" /></label>
              <label className="wide">Provenance <span>release gate</span><textarea value={metadata.provenance} maxLength={500} onChange={(event) => updateMetadata("provenance", event.target.value)} placeholder="Source, collection method, dates, transformations, custodian" /></label>
              <label className="wide">License or permission basis <span>release gate</span><input value={metadata.license} maxLength={500} onChange={(event) => updateMetadata("license", event.target.value)} placeholder="SPDX license or documented owner approval" /></label>
              <label>Label column<input value={metadata.labelColumn} maxLength={128} onChange={(event) => updateMetadata("labelColumn", event.target.value)} placeholder="label" /></label>
              <label>Split column<input value={metadata.splitColumn} maxLength={128} onChange={(event) => updateMetadata("splitColumn", event.target.value)} placeholder="split" /></label>
              <label>Identifier column<input value={metadata.idColumn} maxLength={128} onChange={(event) => updateMetadata("idColumn", event.target.value)} placeholder="id" /></label>
            </div>
            <p className="metadata-disclosure">Metadata is operator-authored and included in downloaded reports. Markdown exports render it as inert text. Do not paste raw records, personal data, or secrets into these fields.</p>

            <button className="button run-button" type="button" onClick={() => void runAudit()} disabled={!intake || busy}>
              <span>{busy ? "Running bounded checks…" : "Run release gate"}</span>
              <span aria-hidden="true">→</span>
            </button>
            {error ? <p className="error-message" role="alert">{error}</p> : null}
          </section>
        </div>
      </section>

      <section
        className={`results-section${report ? " has-report" : ""}`}
        id="audit-results"
        tabIndex={-1}
        aria-live="polite"
      >
        {!report ? (
          <div className="results-empty">
            <span className="empty-glyph" aria-hidden="true">DT</span>
            <div><p className="eyebrow">Awaiting evidence</p><h2>Your release decision will appear here.</h2></div>
            <p>Every finding includes a location, a masked explanation, and a practical remediation. The report never echoes matched PII.</p>
          </div>
        ) : (
          <>
            <div className={`decision decision-${report.status.toLowerCase()}`}>
              <div className="decision-code"><span>{report.status}</span><small>{statusCopy?.eyebrow}</small></div>
              <div className="decision-copy"><h2>{statusCopy?.title}</h2><p>{statusCopy?.body}</p></div>
              <div className="decision-actions">
                <button type="button" onClick={() => downloadText(`${filenameStem}-data-card.md`, report.dataCardMarkdown, "text/markdown;charset=utf-8")}>Download Markdown</button>
                <button type="button" onClick={() => downloadText(`${filenameStem}-data-card.json`, JSON.stringify(report, null, 2), "application/json;charset=utf-8")}>Download JSON</button>
              </div>
            </div>

            <div className="metric-grid">
              <article><span>Blocking groups</span><strong>{report.summary.blockCount}</strong><small>must resolve</small></article>
              <article><span>Warning groups</span><strong>{report.summary.warningCount}</strong><small>needs review</small></article>
              <article><span>PII-like cells</span><strong>{report.summary.piiCellCount}</strong><small>evidence masked</small></article>
              <article><span>Dataset hash</span><strong className="hash-value">{shortHash(report.datasetHash)}</strong><small>SHA-256</small></article>
            </div>

            <div className="findings-layout">
              <div>
                <div className="subsection-heading"><p className="eyebrow">Detector output</p><h3>Findings and remediation</h3></div>
                <div className="finding-list">
                  {report.findings.length ? report.findings.map((item) => (
                    <details className={`finding finding-${item.severity}`} key={item.id} open={item.severity === "block"}>
                      <summary>
                        <span className="severity-mark">{item.severity === "block" ? "B" : "W"}</span>
                        <span><strong>{item.title}</strong><small>{item.summary}</small></span>
                        <span className="finding-count">{item.count}</span>
                      </summary>
                      <div className="finding-body">
                        <p className="remediation"><strong>Recommended action</strong>{item.remediation}</p>
                        <div className="evidence-list">
                          {item.evidence.map((evidence) => (
                            <div key={evidence.key}>
                              <span>{evidence.row ? `Row ${evidence.row}` : "Metadata"}{evidence.otherRow ? ` ↔ ${evidence.otherRow}` : ""}{evidence.column ? ` · ${evidence.column}` : ""}</span>
                              <p>{evidence.maskedValue ? `${evidence.maskedValue} · ` : ""}{evidence.detail}</p>
                            </div>
                          ))}
                          {item.count > item.evidence.length ? <small>+ {item.count - item.evidence.length} additional location(s) in the aggregate count.</small> : null}
                        </div>
                      </div>
                    </details>
                  )) : (
                    <div className="no-findings"><strong>No configured finding fired.</strong><p>Keep the hashes and complete domain-specific review before release.</p></div>
                  )}
                </div>
              </div>

              <aside className="trace-card">
                <p className="eyebrow">Audit trace</p>
                <dl>
                  <div><dt>Rows / columns</dt><dd>{report.summary.rowCount} / {report.summary.columnCount}</dd></div>
                  <div><dt>Exact pairs</dt><dd>{report.summary.exactDuplicatePairs}</dd></div>
                  <div><dt>Near pairs</dt><dd>{report.summary.nearDuplicatePairs}</dd></div>
                  <div><dt>Near comparisons</dt><dd>{report.summary.nearDuplicateComparisons} / {report.summary.nearDuplicateComparisonLimit}{report.summary.nearDuplicatePairScanCapped ? " (capped)" : ""}</dd></div>
                  <div><dt>Rows at token budget</dt><dd>{report.summary.nearDuplicateRowsAtTokenLimit} / {report.summary.rowCount} ({report.summary.nearDuplicateTokenLimit} matches/row)</dd></div>
                  <div><dt>Leakage pairs</dt><dd>{report.summary.leakagePairs}</dd></div>
                  <div><dt>Label conflicts</dt><dd>{report.summary.conflictingGroups}</dd></div>
                  <div><dt>Label column</dt><dd>{report.summary.inferredColumns.label ?? "—"}</dd></div>
                  <div><dt>Split column</dt><dd>{report.summary.inferredColumns.split ?? "—"}</dd></div>
                </dl>
                <div className="hash-block"><span>Report SHA-256</span><code>{report.reportHash}</code></div>
                <p className="trace-note">The hash excludes the generation timestamp and rendered Markdown.</p>
              </aside>
            </div>

            <section className="regression-section" id="regression">
              <div className="regression-header">
                <div><p className="eyebrow">Maintained rule checks</p><h3>Fixed detector regression suite</h3><p>{report.regressionSuite.scope}</p></div>
                <div className="regression-score"><span>Expected findings</span><strong>{report.regressionSuite.matchedExpectedFindings}/{report.regressionSuite.expectedFindings}</strong><small>Unexpected {report.regressionSuite.unexpectedFindings} · Missed {report.regressionSuite.missedExpectedFindings}</small></div>
              </div>
              <div className="regression-meta">
                <span>ID <code>{report.regressionSuite.id}</code></span>
                <span>Suite <code>{report.regressionSuite.suiteVersion}</code></span>
                <span>Clean rows flagged <code>{report.regressionSuite.cleanRowsFlagged}/{report.regressionSuite.cleanRows}</code></span>
              </div>
              <div className="regression-table-wrap">
                <table>
                  <thead><tr><th>Detector</th><th>Expected</th><th>Matched</th><th>Unexpected</th><th>Missed</th></tr></thead>
                  <tbody>{report.regressionSuite.byCategory.map((metric) => (
                    <tr key={metric.category}>
                      <th>{metric.category}</th><td>{metric.expected}</td><td>{metric.matched}</td><td>{metric.unexpected}</td><td>{metric.missed}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
              <div className="artifact-hashes">
                <span>Input artifact <code>{shortHash(report.regressionSuite.inputArtifactHash)}</code></span>
                <span>Gold artifact <code>{shortHash(report.regressionSuite.goldArtifactHash)}</code></span>
              </div>
            </section>
          </>
        )}
      </section>

      <section className="method-section" id="method">
        <div className="section-heading">
          <div><p className="eyebrow">Method, not magic</p><h2>What the gate actually does</h2></div>
          <p>Transparent detectors are easier to test, challenge, and replace. Each result is an inspection signal—not a claim that the dataset is safe or fit for every use.</p>
        </div>
        <div className="method-grid">
          <article><span>01</span><h3>Pattern controls</h3><p>Email, Malaysian mobile, NRIC-like, and IPv4 patterns. Matches are located and masked in output.</p></article>
          <article><span>02</span><h3>Record integrity</h3><p>Canonical row fingerprints expose exact repeats, split crossover, and identical features with conflicting labels.</p></article>
          <article><span>03</span><h3>Similarity review</h3><p>Deterministic token Jaccard similarity flags highly similar text records without an external embedding service.</p></article>
          <article><span>04</span><h3>Distribution review</h3><p>Label counts surface material imbalance and keep per-class evaluation visible.</p></article>
          <article><span>05</span><h3>Governance gate</h3><p>Missing provenance and license or permission basis stop a release instead of becoming documentation debt.</p></article>
          <article><span>06</span><h3>Evidence artifact</h3><p>Stable hashes, masked findings, remediations, and a downloadable data card support reproducible review.</p></article>
        </div>
      </section>

      <footer>
        <div><span className="brand-mark small" aria-hidden="true"><span /></span><strong>DataTrust Gate</strong></div>
        <p>Built as an inspectable student engineering prototype. No upload storage. No legal or privacy certification.</p>
        <a href="#top">Back to top ↑</a>
      </footer>
    </main>
  );
}
