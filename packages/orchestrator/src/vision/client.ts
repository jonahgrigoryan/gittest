import {
  credentials,
  Metadata,
  status,
  type ClientUnaryCall,
  type ServiceError,
} from "@grpc/grpc-js";
import type { Position, Card, Rank, Suit } from "@poker-bot/shared";
import { vision, visionGen } from "@poker-bot/shared";
const VisionServiceClient = visionGen.VisionServiceClient;
type VisionServiceClientInstance = InstanceType<
  typeof visionGen.VisionServiceClient
>;
type RpcVisionOutput = visionGen.VisionOutput;
type HealthStatus = visionGen.HealthStatus;
type RpcActionButtons = visionGen.ActionButtons;
type RpcButtonInfo = visionGen.ButtonInfo;

const POSITION_VALUES: Position[] = ["BTN", "SB", "BB", "UTG", "MP", "CO"];
const RANK_VALUES: Rank[] = [
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "T",
  "J",
  "Q",
  "K",
  "A",
];
const SUIT_VALUES: Suit[] = ["h", "d", "c", "s"];
type RpcCardData = NonNullable<RpcVisionOutput["cards"]>;

const DEFAULT_TIMEOUT_MS = 2000;
const DEFAULT_RETRY_LIMIT = 3;
const DEFAULT_RETRY_BACKOFF_BASE_MS = 100;
const DEFAULT_RETRY_BACKOFF_MAX_MS = 400;

type SleepFn = (ms: number) => Promise<void>;
type VisionClientConfigInput = number | VisionClientOptions;

interface VisionCaptureOptions {
  signal?: AbortSignal;
}

interface NormalizedVisionClientOptions {
  timeoutMs: number;
  retryLimit: number;
  retryBackoffBaseMs: number;
  retryBackoffMaxMs: number;
  sleep: SleepFn;
}

export interface VisionClientOptions {
  timeoutMs?: number;
  retryLimit?: number;
  retryBackoffBaseMs?: number;
  retryBackoffMaxMs?: number;
  sleep?: SleepFn;
}

class VisionCaptureAbortedError extends Error {
  constructor(message = "Vision capture aborted", options?: { cause?: unknown }) {
    super(message, options);
    this.name = "VisionCaptureAbortedError";
  }
}

class VisionCaptureTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Vision capture timed out after ${timeoutMs}ms`);
    this.name = "VisionCaptureTimeoutError";
  }
}

export class VisionClient {
  private readonly client: VisionServiceClientInstance;
  private readonly layoutJson: string;
  private readonly timeoutMs: number;
  private readonly retryLimit: number;
  private readonly retryBackoffBaseMs: number;
  private readonly retryBackoffMaxMs: number;
  private readonly sleep: SleepFn;

  constructor(
    serviceUrl: string,
    layoutPack: vision.LayoutPack,
    optionsOrTimeoutMs?: VisionClientConfigInput,
  ) {
    this.client = new VisionServiceClient(
      serviceUrl,
      credentials.createInsecure(),
    );
    this.layoutJson = JSON.stringify(layoutPack);
    const options = this.normalizeOptions(optionsOrTimeoutMs);
    this.timeoutMs = options.timeoutMs;
    this.retryLimit = options.retryLimit;
    this.retryBackoffBaseMs = options.retryBackoffBaseMs;
    this.retryBackoffMaxMs = options.retryBackoffMaxMs;
    this.sleep = options.sleep;
  }

  async captureAndParse(
    options?: VisionCaptureOptions,
  ): Promise<vision.VisionOutput> {
    const signal = options?.signal;
    const maxAttempts = 1 + this.retryLimit;
    let attempt = 0;

    while (attempt < maxAttempts) {
      this.throwIfAborted(signal);
      attempt += 1;
      try {
        const response = await this.captureOnce(signal);
        return this.transformVisionOutput(response);
      } catch (error) {
        if (this.isAbortError(error)) {
          throw error;
        }
        if (!this.isRetryableError(error) || attempt >= maxAttempts) {
          throw error;
        }

        const backoffMs = this.computeBackoffDelayMs(attempt);
        await this.waitForBackoff(backoffMs, signal);
      }
    }

    throw new Error("Vision capture failed after retry attempts");
  }

  private async captureOnce(signal?: AbortSignal): Promise<RpcVisionOutput> {
    this.throwIfAborted(signal);
    const request = { layoutJson: this.layoutJson };
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let call: ClientUnaryCall | undefined;

    const callPromise = new Promise<RpcVisionOutput>((resolve, reject) => {
      let settled = false;
      let abortListener: (() => void) | undefined;

      const cleanup = () => {
        if (abortListener && signal) {
          signal.removeEventListener("abort", abortListener);
          abortListener = undefined;
        }
      };

      const resolveOnce = (value: RpcVisionOutput) => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        resolve(value);
      };

      const rejectOnce = (error: Error) => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        reject(error);
      };

      if (signal) {
        abortListener = () => {
          if (call) {
            call.cancel();
          }
          rejectOnce(this.toAbortError(signal));
        };

        if (signal.aborted) {
          abortListener();
          return;
        }

        signal.addEventListener("abort", abortListener);
      }

      call = this.client.captureFrame(
        request,
        (error: ServiceError | null, result?: RpcVisionOutput) => {
          if (error) {
            rejectOnce(error);
            return;
          }
          if (!result) {
            rejectOnce(new Error("Vision capture returned empty result"));
            return;
          }
          resolveOnce(result);
        },
      );
    });

    if (this.timeoutMs <= 0) {
      const response = await callPromise;
      return response;
    }

    const timeoutPromise = new Promise<RpcVisionOutput>((_, reject) => {
      timeoutId = setTimeout(() => {
        if (call) {
          call.cancel();
        }
        reject(new VisionCaptureTimeoutError(this.timeoutMs));
      }, this.timeoutMs);
    });

    return Promise.race([callPromise, timeoutPromise]).finally(
      () => {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
      },
    );
  }

  async healthCheck(metadata?: Metadata): Promise<boolean> {
    return new Promise<boolean>((resolve, reject) => {
      const md = metadata ?? new Metadata();
      this.client.healthCheck(
        {},
        md,
        (error: Error | null, status: HealthStatus) => {
          if (error) {
            reject(error);
            return;
          }
          resolve(Boolean(status?.healthy));
        },
      );
    });
  }

  close(): void {
    this.client.close();
  }

  private normalizeOptions(
    optionsOrTimeoutMs?: VisionClientConfigInput,
  ): NormalizedVisionClientOptions {
    if (
      typeof optionsOrTimeoutMs === "number" ||
      optionsOrTimeoutMs === undefined
    ) {
      return {
        timeoutMs: this.normalizeTimeoutMs(optionsOrTimeoutMs),
        retryLimit: DEFAULT_RETRY_LIMIT,
        retryBackoffBaseMs: DEFAULT_RETRY_BACKOFF_BASE_MS,
        retryBackoffMaxMs: DEFAULT_RETRY_BACKOFF_MAX_MS,
        sleep: this.defaultSleep,
      };
    }

    const timeoutMs = this.normalizeTimeoutMs(optionsOrTimeoutMs.timeoutMs);
    const retryLimit = this.normalizeRetryLimit(optionsOrTimeoutMs.retryLimit);
    const retryBackoffBaseMs = this.normalizeBackoffMs(
      optionsOrTimeoutMs.retryBackoffBaseMs,
      DEFAULT_RETRY_BACKOFF_BASE_MS,
    );
    const retryBackoffMaxMsRaw = this.normalizeBackoffMs(
      optionsOrTimeoutMs.retryBackoffMaxMs,
      DEFAULT_RETRY_BACKOFF_MAX_MS,
    );

    return {
      timeoutMs,
      retryLimit,
      retryBackoffBaseMs,
      retryBackoffMaxMs: Math.max(retryBackoffBaseMs, retryBackoffMaxMsRaw),
      sleep: optionsOrTimeoutMs.sleep ?? this.defaultSleep,
    };
  }

  private normalizeTimeoutMs(timeoutMs?: number): number {
    const normalized =
      typeof timeoutMs === "number" && Number.isFinite(timeoutMs)
        ? timeoutMs
        : DEFAULT_TIMEOUT_MS;
    return Math.max(0, Math.trunc(normalized));
  }

  private normalizeRetryLimit(retryLimit?: number): number {
    const normalized =
      typeof retryLimit === "number" && Number.isFinite(retryLimit)
        ? retryLimit
        : DEFAULT_RETRY_LIMIT;
    return Math.max(0, Math.trunc(normalized));
  }

  private normalizeBackoffMs(backoffMs: number | undefined, fallback: number): number {
    const normalized =
      typeof backoffMs === "number" && Number.isFinite(backoffMs)
        ? backoffMs
        : fallback;
    return Math.max(1, Math.trunc(normalized));
  }

  private computeBackoffDelayMs(attempt: number): number {
    const uncapped = this.retryBackoffBaseMs * 2 ** Math.max(0, attempt - 1);
    return Math.min(this.retryBackoffMaxMs, uncapped);
  }

  private async waitForBackoff(
    backoffMs: number,
    signal?: AbortSignal,
  ): Promise<void> {
    if (!signal) {
      await this.sleep(backoffMs);
      return;
    }

    this.throwIfAborted(signal);

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      let abortListener: (() => void) | undefined;

      const cleanup = () => {
        if (abortListener) {
          signal.removeEventListener("abort", abortListener);
          abortListener = undefined;
        }
      };

      const resolveOnce = () => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        resolve();
      };

      const rejectOnce = (error: Error) => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        reject(error);
      };

      abortListener = () => {
        rejectOnce(this.toAbortError(signal));
      };

      signal.addEventListener("abort", abortListener);

      this.sleep(backoffMs)
        .then(resolveOnce)
        .catch((error) => {
          const normalizedError =
            error instanceof Error ? error : new Error(String(error));
          rejectOnce(normalizedError);
        });
    });
  }

  private isRetryableError(error: unknown): boolean {
    if (error instanceof VisionCaptureTimeoutError) {
      return true;
    }

    if (!error || typeof error !== "object") {
      return false;
    }

    const code =
      "code" in error
        ? (error as { code?: number }).code
        : undefined;

    return (
      code === status.UNAVAILABLE ||
      code === status.DEADLINE_EXCEEDED
    );
  }

  private isAbortError(error: unknown): boolean {
    return error instanceof VisionCaptureAbortedError;
  }

  private throwIfAborted(signal?: AbortSignal): void {
    if (!signal || !signal.aborted) {
      return;
    }
    throw this.toAbortError(signal);
  }

  private toAbortError(signal: AbortSignal): Error {
    const reason = signal.reason;
    if (reason instanceof VisionCaptureAbortedError) {
      return reason;
    }

    if (reason instanceof Error) {
      return new VisionCaptureAbortedError(reason.message, { cause: reason });
    }

    if (typeof reason === "string" && reason.length > 0) {
      return new VisionCaptureAbortedError(reason, { cause: reason });
    }

    return new VisionCaptureAbortedError(undefined, { cause: reason });
  }

  private readonly defaultSleep: SleepFn = async (ms: number) =>
    new Promise<void>((resolve) => {
      setTimeout(resolve, ms);
    });

  private transformVisionOutput(output: RpcVisionOutput): vision.VisionOutput {
    const stacks = new Map<Position, { amount: number; confidence: number }>();
    Object.entries(output.stacks ?? {}).forEach(([position, info]) => {
      if (this.isPosition(position) && info) {
        stacks.set(position, {
          amount: info.amount ?? 0,
          confidence: info.confidence ?? 0,
        });
      }
    });

    const occlusion = new Map<string, number>();
    Object.entries(output.occlusion ?? {}).forEach(([key, value]) => {
      occlusion.set(key, value ?? 0);
    });

    const dealer = this.isPosition(output.buttons?.dealer)
      ? output.buttons?.dealer
      : "BTN";

    const actionButtons = this.transformActionButtons(output.actionButtons);

    const turnState = output.turnState
      ? {
          isHeroTurn: Boolean(output.turnState.isHeroTurn),
          actionTimer: output.turnState.actionTimer ?? 0,
          confidence: output.turnState.confidence ?? 0,
        }
      : undefined;

    return {
      timestamp: output.timestamp ?? Date.now(),
      cards: {
        holeCards: this.transformCards(output.cards?.holeCards),
        communityCards: this.transformCards(output.cards?.communityCards),
        confidence: output.cards?.confidence ?? 0,
      },
      stacks,
      pot: {
        amount: output.pot?.amount ?? 0,
        confidence: output.pot?.confidence ?? 0,
      },
      buttons: {
        dealer,
        confidence: output.buttons?.confidence ?? 0,
      },
      positions: {
        confidence: output.positions?.confidence ?? 0,
      },
      occlusion,
      actionButtons,
      turnState,
      latency: {
        capture: output.latency?.capture ?? 0,
        extraction: output.latency?.extraction ?? 0,
        total: output.latency?.total ?? 0,
      },
    };
  }

  private transformCards(cards?: RpcCardData["holeCards"]): Card[] {
    if (!cards) {
      return [];
    }
    return cards
      .map((card) => this.toDomainCard(card))
      .filter((card): card is Card => card !== null);
  }

  private toDomainCard(card: RpcCardData["holeCards"][number]): Card | null {
    if (!this.isRank(card.rank) || !this.isSuit(card.suit)) {
      return null;
    }
    return { rank: card.rank, suit: card.suit };
  }

  private transformActionButtons(
    actionButtons?: RpcActionButtons,
  ): vision.VisionOutput["actionButtons"] {
    if (!actionButtons) {
      return undefined;
    }

    const map: Record<string, vision.ButtonInfo> = {};
    const entries: Array<
      [keyof RpcActionButtons & string, RpcButtonInfo | undefined]
    > = [
      ["fold", actionButtons.fold],
      ["check", actionButtons.check],
      ["call", actionButtons.call],
      ["raise", actionButtons.raise],
      ["bet", actionButtons.bet],
      ["allIn", actionButtons.allIn],
    ];

    entries.forEach(([key, value]) => {
      if (!value) {
        return;
      }
      map[key] = {
        screenCoords: value.screenCoords
          ? { x: value.screenCoords.x ?? 0, y: value.screenCoords.y ?? 0 }
          : { x: 0, y: 0 },
        isEnabled: Boolean(value.isEnabled),
        isVisible: Boolean(value.isVisible),
        confidence: value.confidence ?? 0,
        text: value.text ?? "",
      };
    });

    return Object.keys(map).length > 0
      ? (map as vision.VisionOutput["actionButtons"])
      : undefined;
  }

  private isPosition(value: string | undefined): value is Position {
    return value !== undefined && POSITION_VALUES.includes(value as Position);
  }

  private isRank(value: string | undefined): value is Rank {
    return value !== undefined && RANK_VALUES.includes(value as Rank);
  }

  private isSuit(value: string | undefined): value is Suit {
    return value !== undefined && SUIT_VALUES.includes(value as Suit);
  }
}
