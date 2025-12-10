import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";

const RESULTS_DIR = path.resolve(__dirname, "..", "results");
const REPORT_PATH = path.join(RESULTS_DIR, "replay", "report.json");
const OUTPUT_PATH = path.join(RESULTS_DIR, "verification.json");

interface TimingStats {
  mean: number;
  p95: number;
}

interface ReplaySummary {
  actionMatchRate: number;
  p95Divergence: number;
  decisionTiming?: {
    total: TimingStats;
    gto: TimingStats;
    agents: TimingStats;
  };
  replayDurationMs?: TimingStats;
}

function loadReport(): ReplaySummary {
  if (!existsSync(REPORT_PATH)) {
    throw new Error(`Replay report not found at ${REPORT_PATH}. Run the replay smoke test first.`);
  }
  const raw = readFileSync(REPORT_PATH, "utf-8");
  const report = JSON.parse(raw);
  if (!report?.summary) {
    throw new Error("Replay report missing summary block.");
  }
  return report.summary as ReplaySummary;
}

function main() {
  const summary = loadReport();
  const metrics = {
    actionMatchRate: summary.actionMatchRate ?? 0,
    p95Divergence: summary.p95Divergence ?? Infinity,
    decisionP95: summary.decisionTiming?.total?.p95 ?? Infinity,
    gtoDecisionP95: summary.decisionTiming?.gto?.p95 ?? Infinity,
    agentDecisionP95: summary.decisionTiming?.agents?.p95 ?? Infinity,
    replayDurationP95: summary.replayDurationMs?.p95 ?? Infinity
  };

  const thresholds = {
    actionMatchRate: 0.95,
    p95Divergence: 5,
    decisionP95: 2000,
    gtoDecisionP95: 800,
    agentDecisionP95: 1500,
    replayDurationP95: 2500
  };

  const failures: string[] = [];
  if (metrics.actionMatchRate < thresholds.actionMatchRate) {
    failures.push(
      `Action match rate ${metrics.actionMatchRate.toFixed(3)} below ${thresholds.actionMatchRate}`
    );
  }
  if (metrics.p95Divergence > thresholds.p95Divergence) {
    failures.push(
      `P95 divergence ${metrics.p95Divergence.toFixed(2)} exceeds ${thresholds.p95Divergence}`
    );
  }
  if (metrics.decisionP95 > thresholds.decisionP95) {
    failures.push(
      `Decision total P95 ${metrics.decisionP95.toFixed(2)}ms exceeds ${thresholds.decisionP95}ms`
    );
  }
  if (metrics.gtoDecisionP95 > thresholds.gtoDecisionP95) {
    failures.push(
      `GTO decision P95 ${metrics.gtoDecisionP95.toFixed(2)}ms exceeds ${thresholds.gtoDecisionP95}ms`
    );
  }
  if (metrics.agentDecisionP95 > thresholds.agentDecisionP95) {
    failures.push(
      `Agent decision P95 ${metrics.agentDecisionP95.toFixed(2)}ms exceeds ${thresholds.agentDecisionP95}ms`
    );
  }
  if (metrics.replayDurationP95 > thresholds.replayDurationP95) {
    failures.push(
      `Replay duration P95 ${metrics.replayDurationP95.toFixed(2)}ms exceeds ${thresholds.replayDurationP95}ms`
    );
  }

  mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(
    OUTPUT_PATH,
    JSON.stringify(
      {
        metrics,
        thresholds,
        passed: failures.length === 0,
        timestamp: new Date().toISOString()
      },
      null,
      2
    ),
    "utf-8"
  );

  if (failures.length > 0) {
    throw new Error(`Replay verification failed:\n- ${failures.join("\n- ")}`);
  }

  console.log("Replay verification passed:", JSON.stringify(metrics, null, 2));
}

main();

