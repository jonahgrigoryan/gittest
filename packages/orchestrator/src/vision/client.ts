import { credentials, Metadata } from "@grpc/grpc-js";
import type { Position, Card, Rank, Suit } from "@poker-bot/shared";
import type { vision } from "@poker-bot/shared";

import {
  type ActionButtons as RpcActionButtons,
  type ButtonInfo as RpcButtonInfo,
  type HealthStatus,
  type VisionOutput as RpcVisionOutput,
  VisionServiceClient
} from "@poker-bot/shared/dist/gen/vision";

const POSITION_VALUES: Position[] = ["BTN", "SB", "BB", "UTG", "MP", "CO"];
const RANK_VALUES: Rank[] = ["2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K", "A"];
const SUIT_VALUES: Suit[] = ["h", "d", "c", "s"];
type RpcCardData = NonNullable<RpcVisionOutput["cards"]>;

export class VisionClient {
  private readonly client: VisionServiceClient;

  private readonly layoutJson: string;

  constructor(serviceUrl: string, layoutPack: vision.LayoutPack) {
    this.client = new VisionServiceClient(serviceUrl, credentials.createInsecure());
    this.layoutJson = JSON.stringify(layoutPack);
  }

  async captureAndParse(): Promise<vision.VisionOutput> {
    const request = { layoutJson: this.layoutJson };
    const response = await new Promise<RpcVisionOutput>((resolve, reject) => {
      this.client.captureFrame(request, (error, result) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(result);
      });
    });
    return this.transformVisionOutput(response);
  }

  async healthCheck(metadata?: Metadata): Promise<boolean> {
    return new Promise<boolean>((resolve, reject) => {
      const md = metadata ?? new Metadata();
      this.client.healthCheck({}, md, (error, status: HealthStatus) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(Boolean(status?.healthy));
      });
    });
  }

  close(): void {
    this.client.close();
  }

  private transformVisionOutput(output: RpcVisionOutput): vision.VisionOutput {
    const stacks = new Map<Position, { amount: number; confidence: number }>();
    Object.entries(output.stacks ?? {}).forEach(([position, info]) => {
      if (this.isPosition(position) && info) {
        stacks.set(position, { amount: info.amount ?? 0, confidence: info.confidence ?? 0 });
      }
    });

    const occlusion = new Map<string, number>();
    Object.entries(output.occlusion ?? {}).forEach(([key, value]) => {
      occlusion.set(key, value ?? 0);
    });

    const dealer = this.isPosition(output.buttons?.dealer) ? output.buttons?.dealer : "BTN";

    const actionButtons = this.transformActionButtons(output.actionButtons);

    const turnState = output.turnState
      ? {
          isHeroTurn: Boolean(output.turnState.isHeroTurn),
          actionTimer: output.turnState.actionTimer ?? 0,
          confidence: output.turnState.confidence ?? 0
        }
      : undefined;

    return {
      timestamp: output.timestamp ?? Date.now(),
      cards: {
        holeCards: this.transformCards(output.cards?.holeCards),
        communityCards: this.transformCards(output.cards?.communityCards),
        confidence: output.cards?.confidence ?? 0
      },
      stacks,
      pot: {
        amount: output.pot?.amount ?? 0,
        confidence: output.pot?.confidence ?? 0
      },
      buttons: {
        dealer,
        confidence: output.buttons?.confidence ?? 0
      },
      positions: {
        confidence: output.positions?.confidence ?? 0
      },
      occlusion,
      actionButtons,
      turnState,
      latency: {
        capture: output.latency?.capture ?? 0,
        extraction: output.latency?.extraction ?? 0,
        total: output.latency?.total ?? 0
      }
    };
  }

  private transformCards(cards?: RpcCardData["holeCards"]): Card[] {
    if (!cards) {
      return [];
    }
    return cards
      .map(card => this.toDomainCard(card))
      .filter((card): card is Card => card !== null);
  }

  private toDomainCard(card: RpcCardData["holeCards"][number]): Card | null {
    if (!this.isRank(card.rank) || !this.isSuit(card.suit)) {
      return null;
    }
    return { rank: card.rank, suit: card.suit };
  }

  private transformActionButtons(actionButtons?: RpcActionButtons): vision.VisionOutput["actionButtons"] {
    if (!actionButtons) {
      return undefined;
    }

    const map: Record<string, vision.ButtonInfo> = {};
    const entries: Array<[keyof RpcActionButtons, RpcButtonInfo | undefined]> = [
      ["fold", actionButtons.fold],
      ["check", actionButtons.check],
      ["call", actionButtons.call],
      ["raise", actionButtons.raise],
      ["bet", actionButtons.bet],
      ["allIn", actionButtons.allIn]
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
        text: value.text ?? ""
      };
    });

    return Object.keys(map).length > 0 ? (map as vision.VisionOutput["actionButtons"]) : undefined;
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
