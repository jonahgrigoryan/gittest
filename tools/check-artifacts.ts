import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const ROOTS = [path.resolve(__dirname, "..", "results")];
const TEXT_EXTENSIONS = new Set([".json", ".jsonl", ".log", ".txt", ".ndjson"]);
const FORBIDDEN_PATTERNS: Array<{ pattern: RegExp; description: string }> = [
  { pattern: /OPENAI_API_KEY/i, description: "OPENAI_API_KEY token detected" },
  { pattern: /ANTHROPIC_API_KEY/i, description: "ANTHROPIC_API_KEY token detected" },
  { pattern: /sk-[A-Za-z0-9]{20,}/, description: "Possible OpenAI secret format" },
  { pattern: /api[_-]?key\s*[:=]\s*['"]?[A-Za-z0-9-_]{16,}/i, description: "Generic API key" }
];

function isTextFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return TEXT_EXTENSIONS.has(ext);
}

function scanFile(filePath: string): string[] {
  if (!isTextFile(filePath)) {
    return [];
  }
  const content = readFileSync(filePath, "utf-8");
  const hits: string[] = [];
  for (const { pattern, description } of FORBIDDEN_PATTERNS) {
    if (pattern.test(content)) {
      hits.push(`${description} in ${filePath}`);
    }
  }
  return hits;
}

function walk(dir: string): string[] {
  let findings: string[] = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = path.join(dir, entry);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      findings = findings.concat(walk(fullPath));
    } else if (stats.isFile()) {
      findings = findings.concat(scanFile(fullPath));
    }
  }
  return findings;
}

function main() {
  const findings: string[] = [];
  for (const root of ROOTS) {
    if (statExists(root)) {
      findings.push(...walk(root));
    }
  }

  if (findings.length > 0) {
    throw new Error(`Artifact compliance check failed:\n- ${findings.join("\n- ")}`);
  }

  console.log("Artifact compliance check passed.");
}

function statExists(target: string): boolean {
  try {
    statSync(target);
    return true;
  } catch {
    return false;
  }
}

main();

