import { promises as fs } from "node:fs";
import { join } from "node:path";

interface RetentionOptions {
  sessionPrefix?: string;
  activeSessionId?: string;
}

export async function enforceRetention(
  outputDir: string,
  retentionDays: number,
  options: RetentionOptions = {}
): Promise<void> {
  if (retentionDays <= 0) {
    return;
  }
  const now = Date.now();
  await walkDirectory(outputDir, now, retentionDays, options);
}

async function walkDirectory(
  dir: string,
  now: number,
  retentionDays: number,
  options: RetentionOptions
) {
  let entries: fs.Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const filePath = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkDirectory(filePath, now, retentionDays, options);
      continue;
    }

    const matchesPrefix =
      !options.sessionPrefix || filePath.includes(options.sessionPrefix);
    if (!matchesPrefix) {
      continue;
    }
    if (options.activeSessionId && filePath.includes(options.activeSessionId)) {
      continue;
    }

    try {
      const stats = await fs.stat(filePath);
      const ageDays = (now - stats.mtimeMs) / (1000 * 60 * 60 * 24);
      if (ageDays > retentionDays) {
        await fs.rm(filePath);
      }
    } catch {
      /* ignore */
    }
  }
}
