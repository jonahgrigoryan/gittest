import type { HandRecord } from "@poker-bot/shared";

export function renderAcpc(record: HandRecord): string {
  const header = [
    `#${record.handId}`,
    record.rawGameState.gameType,
    `blinds ${record.rawGameState.blinds.small}/${record.rawGameState.blinds.big}`
  ].join(" ");

  const stacks = record.rawGameState.players
    .map(player => `${player.position}:${player.stack.toFixed(2)}`)
    .join(" ");

  const actions = record.rawGameState.actionHistory
    .map(action => {
      const amount = action.amount !== undefined ? `:${action.amount}` : "";
      return `${action.position}:${action.type}${amount}`;
    })
    .join(" ");

  const board = record.rawGameState.communityCards
    .map(card => `${card.rank}${card.suit}`)
    .join("");

  const outcome = record.outcome
    ? `outcome ${record.outcome.netChips.toFixed(2)}`
    : "outcome pending";

  return [header, `stacks ${stacks}`, `actions ${actions}`, `board ${board}`, outcome].join("\n");
}
