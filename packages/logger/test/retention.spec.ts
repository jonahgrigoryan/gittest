import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, rm, stat, utimes } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { enforceRetention } from "../src/retention";

describe("retention", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "retention-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("deletes files past retention window", async () => {
    const filePath = join(dir, "HH_old.json");
    await writeFile(filePath, "{}");
    const epoch = new Date(0);
    await utimes(filePath, epoch, epoch);
    await enforceRetention(dir, 1, { sessionPrefix: "HH" });
    await expect(stat(filePath)).rejects.toThrow();
  });
});
