import type { HandRecord } from "@poker-bot/shared";

export function renderJson(record: HandRecord, pretty = false): string {
  return JSON.stringify(record, null, pretty ? 2 : 0);
}
