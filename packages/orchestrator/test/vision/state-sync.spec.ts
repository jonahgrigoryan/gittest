import { describe, expect, it } from "vitest";

import { StateSyncTracker } from "../../src/vision/state-sync";
import { createParsedState } from "../utils/factories";

describe("State Sync Tracker", () => {
  it("detects impossible pot decrease", () => {
    const tracker = new StateSyncTracker();
    const previous = createParsedState({ pot: 20 });
    tracker.addFrame(previous);

    const current = createParsedState({ pot: 15 });
    const errors = tracker.detectInconsistencies(current);
    expect(errors).toContain("Pot decreased between consecutive frames");
  });

  it("detects impossible stack increase mid-hand", () => {
    const tracker = new StateSyncTracker();
    const previous = createParsedState();
    tracker.addFrame(previous);

    const players = new Map(previous.players);
    players.set("SB", { stack: 150 });
    const current = createParsedState({ players, pot: previous.pot });
    const errors = tracker.detectInconsistencies(current);
    expect(errors.some(error => error.includes("Stack increased"))).toBe(true);
  });

  it("allows valid state transitions", () => {
    const tracker = new StateSyncTracker();
    const previous = createParsedState({ pot: 5 });
    tracker.addFrame(previous);

    const players = new Map(previous.players);
    players.set("SB", { stack: 95 });
    const current = createParsedState({ players, pot: 7 });
    const errors = tracker.detectInconsistencies(current);
    expect(errors).toHaveLength(0);
  });

  it("tracks consecutive error count", () => {
    const tracker = new StateSyncTracker();
    const first = createParsedState({ parseErrors: ["missing cards"] });
    tracker.addFrame(first);
    tracker.addFrame(createParsedState({ parseErrors: ["bad pot"], handId: "hand-002" }));

    expect(tracker.getConsecutiveErrorCount()).toBe(2);

    tracker.addFrame(createParsedState({ parseErrors: [], handId: "hand-003" }));
    expect(tracker.getConsecutiveErrorCount()).toBe(0);
  });
});
