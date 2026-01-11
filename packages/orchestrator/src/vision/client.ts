import { credentials, Metadata, type ClientUnaryCall } from "@grpc/grpc-js";
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

export class VisionClient {
  private readonly client: VisionServiceClientInstance;

  private readonly layoutJson: string;
  private readonly timeoutMs: number;

  constructor(serviceUrl: string, layoutPack: vision.LayoutPack, timeoutMs: number = 5000) {
    this.client = new VisionServiceClient(
      serviceUrl,
      credentials.createInsecure(),
    );
    this.layoutJson = JSON.stringify(layoutPack);
    this.timeoutMs = timeoutMs;
  }

  async captureAndParse(): Promise<vision.VisionOutput> {
    const request = { layoutJson: this.layoutJson };
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let call: ClientUnaryCall | undefined;

    const callPromise = new Promise<RpcVisionOutput>((resolve, reject) => {
      call = this.client.captureFrame(
        request,
        (error: Error | null, result?: RpcVisionOutput) => {
          if (error) {
            reject(error);
            return;
          }
          if (!result) {
            reject(new Error("Vision capture returned empty result"));
            return;
          }
          resolve(result);
        },
      );
    });

    if (this.timeoutMs <= 0) {
      const response = await callPromise;
      return this.transformVisionOutput(response);
    }

    const timeoutPromise = new Promise<RpcVisionOutput>((_, reject) => {
      timeoutId = setTimeout(() => {
        if (call) {
          call.cancel();
        }
        reject(new Error(`Vision capture timed out after ${this.timeoutMs}ms`));
      }, this.timeoutMs);
    });

    const response = await Promise.race([callPromise, timeoutPromise]).finally(
      () => {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
      },
    );
    return this.transformVisionOutput(response);
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
