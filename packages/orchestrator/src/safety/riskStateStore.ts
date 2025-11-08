import { dirname } from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import type { RiskGuardStatePersistence, RiskSnapshot } from "./types";

const EMPTY_STATE: RiskGuardStatePersistence = {
  currentBankroll: 0,
  currentSessionHands: 0,
};

interface FileSystemApi {
  readFile(path: string, encoding: BufferEncoding): Promise<string>;
  writeFile(path: string, data: string): Promise<void>;
  mkdir(path: string, options: { recursive: boolean }): Promise<string | undefined>;
}

const defaultFs: FileSystemApi = {
  readFile,
  writeFile,
  mkdir,
};

export class RiskStateStore {
  private readonly fs: FileSystemApi;

  constructor(private readonly filePath: string, fsApi: FileSystemApi = defaultFs) {
    this.fs = fsApi;
  }

  async load(): Promise<RiskGuardStatePersistence> {
    try {
      const raw = await this.fs.readFile(this.filePath, "utf-8");
      const parsed = JSON.parse(raw) as Partial<RiskGuardStatePersistence>;
      return {
        currentBankroll: this.normalizeNumber(parsed.currentBankroll),
        currentSessionHands: this.normalizeNumber(parsed.currentSessionHands),
      };
    } catch {
      return { ...EMPTY_STATE };
    }
  }

  async save(snapshot: RiskSnapshot): Promise<void> {
    const payload: RiskGuardStatePersistence = {
      currentBankroll: snapshot.netProfit,
      currentSessionHands: snapshot.handsPlayed,
    };
    await this.ensureDirectory();
    await this.fs.writeFile(this.filePath, JSON.stringify(payload, null, 2));
  }

  private async ensureDirectory(): Promise<void> {
    await this.fs.mkdir(dirname(this.filePath), { recursive: true });
  }

  private normalizeNumber(value: unknown): number {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return 0;
    }
    return value;
  }
}
