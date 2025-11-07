import { describe, it, expectTypeOf } from "vitest";
import type {
  PersonaTemplate,
  PromptContext,
  AgentTransport,
  AggregatedAgentOutput,
  TransportResponse
} from "../src";
import type { GameState, ActionType } from "@poker-bot/shared";

describe("agent type exports", () => {
  it("PersonaTemplate prompt signature expects GameState and PromptContext", () => {
    expectTypeOf<PersonaTemplate["prompt"]>().parameters.toEqualTypeOf<[GameState, PromptContext]>();
  });

  it("AgentTransport.invoke returns a Promise of TransportResponse", () => {
    expectTypeOf<Awaited<ReturnType<AgentTransport["invoke"]>>>().toEqualTypeOf<TransportResponse>();
  });

  it("AggregatedAgentOutput exposes normalizedActions as Map", () => {
    expectTypeOf<AggregatedAgentOutput["normalizedActions"]>().toEqualTypeOf<Map<ActionType, number>>();
  });
});
