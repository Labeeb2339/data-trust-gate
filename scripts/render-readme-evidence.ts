import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runFixedRegressionSuite } from "../lib/regression-suite";

const outputUrl = new URL(
  "../public/detector-regression.svg",
  import.meta.url,
);

const categoryLabel: Record<string, string> = {
  "pii-email": "Email pattern",
  "pii-phone": "Malaysian mobile",
  "pii-nric": "NRIC-like pattern",
  "pii-ip": "IPv4 pattern",
  "exact-duplicate": "Exact duplicate",
  "near-duplicate": "Near duplicate",
  "split-leakage": "Split leakage",
  "conflicting-label": "Conflicting label",
  "class-imbalance": "Class imbalance",
  "missing-provenance": "Missing provenance",
  "missing-license": "Missing licence",
};

function escapeXml(value: string) {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[character]!,
  );
}

async function renderSvg() {
  const report = await runFixedRegressionSuite();
  if (
    report.expectedFindings !== 15 ||
    report.matchedExpectedFindings !== 15 ||
    report.unexpectedFindings !== 0 ||
    report.missedExpectedFindings !== 0 ||
    report.cleanRows !== 10 ||
    report.cleanRowsFlagged !== 0
  ) {
    throw new Error(
      "The fixed detector regression result changed; review the README claim before rendering.",
    );
  }

  const groups = [report.byCategory.slice(0, 6), report.byCategory.slice(6)];
  const panels = groups.map((entries, panelIndex) => {
    const originX = panelIndex === 0 ? 80 : 790;
    const rows = entries.map((entry, rowIndex) => {
      if (entry.unexpected !== 0 || entry.missed !== 0) {
        throw new Error(`${entry.category} no longer matches its fixed fixture.`);
      }
      const y = 204 + rowIndex * 72;
      const maxWidth = 250;
      const expectedWidth = (entry.expected / 2) * maxWidth;
      const matchedWidth = (entry.matched / 2) * maxWidth;
      const label = categoryLabel[entry.category] ?? entry.category;
      return `<g>
        <text x="${originX}" y="${y}" class="label">${escapeXml(label)}</text>
        <rect x="${originX + 230}" y="${y - 19}" width="${expectedWidth}" height="22" rx="2" class="expected"/>
        <rect x="${originX + 230}" y="${y - 19}" width="${matchedWidth}" height="22" rx="2" class="matched"/>
        <text x="${originX + 500}" y="${y}" class="value">${entry.matched}/${entry.expected}</text>
      </g>`;
    });
    return `<g>${rows.join("")}</g>`;
  });

  const inputHash = report.inputArtifactHash.slice(0, 12);
  const goldHash = report.goldArtifactHash.slice(0, 12);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1500" height="790" viewBox="0 0 1500 790" role="img" aria-labelledby="title desc">
  <title id="title">DataTrust Gate fixed detector regression coverage</title>
  <desc id="desc">Fifteen expected findings across eleven detector categories are matched in ten maintained synthetic fixture cases. There are zero unexpected findings, zero missed expected findings, and zero of ten clean-control rows flagged.</desc>
  <defs>
    <pattern id="grid" width="34" height="34" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1.5" fill="#29484a"/></pattern>
  </defs>
  <style>
    .title{font:500 38px Inter,Segoe UI,sans-serif;fill:#f2f4ed;letter-spacing:.2px}.kicker{font:700 15px ui-monospace,SFMono-Regular,Consolas,monospace;fill:#c8ef3d;letter-spacing:2px}.subtitle,.scope,.hash{font:400 16px Inter,Segoe UI,sans-serif;fill:#93a7a8}.label{font:500 18px Inter,Segoe UI,sans-serif;fill:#e8eeea}.value{font:700 16px ui-monospace,SFMono-Regular,Consolas,monospace;fill:#f2f4ed}.summary-label{font:500 14px Inter,Segoe UI,sans-serif;fill:#93a7a8;text-transform:uppercase;letter-spacing:1px}.summary-value{font:700 25px ui-monospace,SFMono-Regular,Consolas,monospace;fill:#c8ef3d}.expected{fill:#2a3b3d}.matched{fill:#c8ef3d}.rule{stroke:#365052;stroke-width:1}
  </style>
  <rect width="1500" height="790" fill="#091314"/>
  <rect width="1500" height="790" fill="url(#grid)" opacity=".65"/>
  <rect x="44" y="34" width="1412" height="722" fill="#091314" opacity=".94" stroke="#365052"/>
  <text x="80" y="78" class="kicker">MAINTAINED SYNTHETIC FIXTURES</text>
  <text x="80" y="126" class="title">Fixed detector regression coverage</text>
  <text x="80" y="158" class="subtitle">Filled bar = matched expected finding · scale ends at two findings · this is not an accuracy estimate</text>
  <path d="M80 178H1420" class="rule"/>
  ${panels.join("")}
  <path d="M80 646H1420" class="rule"/>
  <g>
    <text x="80" y="682" class="summary-label">Expected matched</text><text x="80" y="718" class="summary-value">${report.matchedExpectedFindings}/${report.expectedFindings}</text>
    <text x="350" y="682" class="summary-label">Unexpected</text><text x="350" y="718" class="summary-value">${report.unexpectedFindings}</text>
    <text x="570" y="682" class="summary-label">Missed</text><text x="570" y="718" class="summary-value">${report.missedExpectedFindings}</text>
    <text x="760" y="682" class="summary-label">Clean rows flagged</text><text x="760" y="718" class="summary-value">${report.cleanRowsFlagged}/${report.cleanRows}</text>
  </g>
  <text x="1420" y="692" text-anchor="end" class="hash">input ${inputHash} · gold ${goldHash}</text>
  <text x="1420" y="720" text-anchor="end" class="scope">${escapeXml(report.id)} v${escapeXml(report.suiteVersion)}</text>
</svg>
`;
}

const expected = await renderSvg();
const check = process.argv.includes("--check");
const normalizeLineEndings = (value: string) => value.replace(/\r\n/g, "\n");

if (check) {
  let current = "";
  try {
    current = readFileSync(outputUrl, "utf8");
  } catch {
    // A missing file is reported by the stale-evidence message below.
  }
  if (normalizeLineEndings(current) !== expected) {
    process.stderr.write(
      `README evidence is stale. Run npm run evidence:render (${fileURLToPath(outputUrl)}).\n`,
    );
    process.exitCode = 1;
  } else {
    process.stdout.write("README evidence matches the fixed regression suite.\n");
  }
} else {
  writeFileSync(outputUrl, expected, "utf8");
  process.stdout.write(`Wrote ${fileURLToPath(outputUrl)}\n`);
}
