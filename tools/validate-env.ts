import { readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "dotenv";
import { ENV_SCHEMAS, type EnvService } from "../packages/shared/src/env/schema";
import { getMissingEnvVars } from "../packages/shared/src/env/validator";

type TemplateConfig = {
  description: string;
  path: string;
};

const TEMPLATE_MAP: Record<EnvService, TemplateConfig> = {
  root: { description: "root .env example", path: ".env.example" },
  orchestrator: { description: "orchestrator env", path: "env/.env.orchestrator" },
  agents: { description: "agents env", path: "env/.env.agents" },
  executor: { description: "executor env", path: "env/.env.executor" },
  logger: { description: "logger env", path: "env/.env.logger" },
  evaluator: { description: "evaluator env", path: "env/.env.evaluator" },
  solver: { description: "solver env", path: "env/.env.solver" },
  vision: { description: "vision env", path: "env/.env.vision" }
};

function readTemplate(service: EnvService): Record<string, string> {
  const target = TEMPLATE_MAP[service];
  if (!target) {
    return {};
  }

  const absolutePath = path.resolve(process.cwd(), target.path);
  const contents = readFileSync(absolutePath, "utf8");
  return parse(contents);
}

function main() {
  const failures: string[] = [];

  (Object.keys(TEMPLATE_MAP) as EnvService[]).forEach(service => {
    const templateValues = readTemplate(service);
    const missing = getMissingEnvVars(service, templateValues);
    if (missing.length) {
      failures.push(`${service}: missing ${missing.join(", ")}`);
    }
  });

  if (failures.length) {
    console.error("Environment template validation failed:\n");
    failures.forEach(failure => console.error(` • ${failure}`));
    process.exitCode = 1;
    return;
  }

  console.log("All environment templates satisfy the schema:", Object.keys(ENV_SCHEMAS).join(", "));
}

main();

