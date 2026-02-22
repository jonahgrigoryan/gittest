import { describe, it, expect } from "vitest";
import { ActionVerifier } from "../src/verifier";
import type { VisionClientInterface } from "../src/verifier";
import type { Action } from "@poker-bot/shared";

const mockAction: Action = {
  type: "call",
  position: "BTN",
  street: "flop",
  amount: 10
};

describe("ActionVerifier", () => {
  it("fails when vision client cannot provide high confidence state", async () => {
    const visionClient: VisionClientInterface = {
      captureAndParse: async (_options) => ({
        confidence: { overall: 0.5 }
      }) as any
    };

    const verifier = new ActionVerifier(visionClient, console);
    const result = await verifier.verifyAction(mockAction, [], 100);
    expect(result.passed).toBe(false);
    expect(result.mismatchReason).toBeDefined();
  });

  it("passes when no mismatches are detected", async () => {
    const visionClient: VisionClientInterface = {
      captureAndParse: async (_options) =>
        ({
          confidence: { overall: 0.999 },
          pot: { amount: 100 },
          actionHistory: [{ type: "call", position: "BTN" }],
          players: new Map()
        }) as any
    };

    const verifier = new ActionVerifier(visionClient, console);
    const result = await verifier.verifyAction(mockAction, [], 1000);
    expect(result.passed).toBe(true);
  });

  it("aborts capture when the timeout elapses", async () => {
    let abortSignal: AbortSignal | undefined;
    let aborted = false;
    const visionClient: VisionClientInterface = {
      captureAndParse: async (options) => {
        abortSignal = options?.signal;
        return await new Promise((_resolve, reject) => {
          options?.signal?.addEventListener("abort", () => {
            aborted = true;
            const abortError = new Error("capture aborted");
            abortError.name = "VisionCaptureAbortedError";
            reject(abortError);
          });
        });
      },
    };

    const verifier = new ActionVerifier(visionClient, console);
    const result = await verifier.verifyAction(mockAction, [], 5);

    expect(result.passed).toBe(false);
    expect(abortSignal).toBeDefined();
    expect(abortSignal?.aborted).toBe(true);
    expect(aborted).toBe(true);
  });
});

