import { runFixedRegressionSuite } from "../lib/regression-suite";

const report = await runFixedRegressionSuite();

if (process.argv.includes("--json")) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} else {
  process.stdout.write(
    [
      `${report.id} · suite ${report.suiteVersion}`,
      `Expected findings matched ${report.matchedExpectedFindings}/${report.expectedFindings}`,
      `Unexpected findings ${report.unexpectedFindings} · missed expected findings ${report.missedExpectedFindings}`,
      `Clean rows flagged ${report.cleanRowsFlagged}/${report.cleanRows}`,
      `Input SHA-256 ${report.inputArtifactHash}`,
      `Gold SHA-256 ${report.goldArtifactHash}`,
      report.scope,
    ].join("\n") + "\n",
  );
}
