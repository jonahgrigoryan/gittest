import type { HandRecord } from "@poker-bot/shared";
import type { RedactionConfig } from "./types";

interface RedactionResult {
  record: HandRecord;
  redactedFields: string[];
}

const IP_REGEX =
  /\b(?:(?:25[0-5]|2[0-4]\d|1?\d{1,2})(?:\.(?!$)|$)){4}\b/g;

export function redactHandRecord(record: HandRecord, config: RedactionConfig): RedactionResult {
  if (!config.enabled || config.fields.length === 0) {
    return { record, redactedFields: [] };
  }

  const clone: HandRecord = structuredClone(record);
  const redactedFields: string[] = [];

  for (const field of config.fields) {
    switch (field) {
      case "playerNames":
        redactPlayerNames(clone, redactedFields);
        break;
      case "ids":
        redactIdentifiers(clone, redactedFields);
        break;
      case "ipAddresses":
        redactIpAddresses(clone, redactedFields);
        break;
      case "reasoning":
        redactReasoning(clone, redactedFields);
        break;
    }
  }

  if (redactedFields.length > 0) {
    clone.metadata.redactionApplied = true;
    clone.metadata.redactedFields = Array.from(new Set(redactedFields));
  } else {
    clone.metadata.redactionApplied = false;
    delete clone.metadata.redactedFields;
  }

  return { record: clone, redactedFields: clone.metadata.redactedFields ?? [] };
}

type SerializedPlayer = HandRecord["rawGameState"]["players"][number] & {
  name?: string;
  alias?: string;
};

function redactPlayerNames(record: HandRecord, redactedFields: string[]) {
  const players = record.rawGameState.players as SerializedPlayer[];
  players.forEach((player, idx) => {
    if (player.name) {
      delete player.name;
      redactedFields.push(`rawGameState.players.${idx}.name`);
    }
    player.alias = `Player${idx + 1}`;
    redactedFields.push(`rawGameState.players.${idx}.alias`);
  });
}

function redactIdentifiers(record: HandRecord, redactedFields: string[]) {
  record.decision.metadata.configHash = record.decision.metadata.configHash.slice(0, 12);
  redactedFields.push("decision.metadata.configHash");
  if (record.execution?.metadata?.windowHandle) {
    delete record.execution.metadata.windowHandle;
    redactedFields.push("execution.metadata.windowHandle");
  }
}

function redactIpAddresses(record: HandRecord, redactedFields: string[]) {
  if (record.agents?.notes) {
    const sanitized = record.agents.notes.replace(IP_REGEX, "[REDACTED]");
    if (sanitized !== record.agents.notes) {
      record.agents.notes = sanitized;
      redactedFields.push("agents.notes");
    }
  }
}

function redactReasoning(record: HandRecord, redactedFields: string[]) {
  if (!record.agents) return;
  record.agents.outputs = record.agents.outputs.map((output, idx) => {
    if (!output.reasoning) {
      return output;
    }
    redactedFields.push(`agents.outputs.${idx}.reasoning`);
    return { ...output, reasoning: "[REDACTED]" };
  });
}
