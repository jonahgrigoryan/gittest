#!/usr/bin/env node
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import path from "node:path";
import { runShadowEvaluation } from "../runner/shadow";

yargs(hideBin(process.argv))
  .scriptName("eval")
  .command<{ session?: string; handsDir: string; outputDir: string; limit?: number }>(
    "shadow",
    "Replay a logged session and emit evaluation metrics",
    builder => builder
      .option("session", {
        type: "string",
        describe: "Session ID (omitting prefix)",
      })
      .option("handsDir", {
        type: "string",
        default: path.resolve(process.cwd(), "../../results/hands"),
        describe: "Directory containing session_<id>/hand_records.jsonl"
      })
      .option("outputDir", {
        type: "string",
        default: path.resolve(process.cwd(), "../../results/eval"),
        describe: "Directory to write evaluation summaries"
      })
      .option("limit", {
        type: "number",
        describe: "Optional hand cap"
      }),
    async args => {
      await runShadowEvaluation({
        sessionId: args.session,
        handsDir: args.handsDir,
        outputDir: args.outputDir,
        limit: args.limit
      });
    }
  )
  .demandCommand()
  .help()
  .strict()
  .parse();
