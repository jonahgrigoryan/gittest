import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { HandRecord } from "@poker-bot/shared";
import { renderJson } from "./json";
import { renderAcpc } from "./acpc";
import type { LoggingFormat } from "../types";

export async function writeExport(
  record: HandRecord,
  format: LoggingFormat,
  baseDir: string
): Promise<void> {
  const dir = join(baseDir, format);
  await mkdir(dir, { recursive: true });
  const filePath = join(dir, `hand_${record.handId}.${format === "json" ? "json" : "txt"}`);
  const payload = format === "json" ? renderJson(record, true) : renderAcpc(record);
  await writeFile(filePath, payload, "utf-8");
}
