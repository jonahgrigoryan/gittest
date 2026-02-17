import { deterministicRandom } from "./rng";
import type { WindowBounds } from "./types";

interface LayoutResolution {
  width: number;
  height: number;
}

export interface CoordinateContext {
  dpiCalibration: number;
  layoutResolution: LayoutResolution;
  windowBounds: WindowBounds;
}

type AutomationKey = "LeftCmd" | "A" | "Backspace";

interface NutJsBindings {
  Key: Record<AutomationKey, unknown>;
  Point: new (x: number, y: number) => unknown;
  keyboard: {
    type(text: string): Promise<void>;
    pressKey(...keys: unknown[]): Promise<void>;
    releaseKey(...keys: unknown[]): Promise<void>;
  };
  mouse: {
    config: { mouseSpeed: number };
    move(path: unknown): Promise<void>;
    leftClick(): Promise<void>;
  };
  straightTo(point: unknown): unknown;
}

export interface CoordinateTranslator {
  visionToScreenCoords(
    visionX: number,
    visionY: number,
    layoutResolution: LayoutResolution,
    windowBounds: WindowBounds,
    dpiCalibration: number
  ): { x: number; y: number };
}

export interface MouseKeyboardProvider {
  setMouseSpeed(speed: number): void | Promise<void>;
  moveMouse(point: { x: number; y: number }): Promise<void>;
  leftClick(): Promise<void>;
  typeText(text: string): Promise<void>;
  pressKey(...keys: AutomationKey[]): Promise<void>;
  releaseKey(...keys: AutomationKey[]): Promise<void>;
}

export interface InputAutomationOptions {
  mouseSpeed?: number;
  randomSeed?: number;
  sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_MOUSE_SPEED = 1500;

let nutJsBindingsPromise: Promise<NutJsBindings> | undefined;

async function loadNutJsBindings(): Promise<NutJsBindings> {
  if (nutJsBindingsPromise) {
    return nutJsBindingsPromise;
  }

  nutJsBindingsPromise = import("@nut-tree/nut-js")
    .then((mod) => ({
      Key: mod.Key as Record<AutomationKey, unknown>,
      Point: mod.Point as new (x: number, y: number) => unknown,
      keyboard: mod.keyboard as unknown as NutJsBindings["keyboard"],
      mouse: mod.mouse as unknown as NutJsBindings["mouse"],
      straightTo: mod.straightTo as (point: unknown) => unknown
    }))
    .catch((error) => {
      nutJsBindingsPromise = undefined;
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to load @nut-tree/nut-js bindings: ${message}`);
    });

  return nutJsBindingsPromise;
}

class NutJsMouseKeyboardProvider implements MouseKeyboardProvider {
  async setMouseSpeed(speed: number): Promise<void> {
    const { mouse } = await loadNutJsBindings();
    mouse.config.mouseSpeed = speed;
  }

  async moveMouse(point: { x: number; y: number }): Promise<void> {
    const { mouse, Point, straightTo } = await loadNutJsBindings();
    await mouse.move(straightTo(new Point(Math.round(point.x), Math.round(point.y))));
  }

  async leftClick(): Promise<void> {
    const { mouse } = await loadNutJsBindings();
    await mouse.leftClick();
  }

  async typeText(text: string): Promise<void> {
    const { keyboard } = await loadNutJsBindings();
    await keyboard.type(text);
  }

  async pressKey(...keys: AutomationKey[]): Promise<void> {
    const { keyboard } = await loadNutJsBindings();
    await keyboard.pressKey(...(await this.resolveKeys(keys)));
  }

  async releaseKey(...keys: AutomationKey[]): Promise<void> {
    const { keyboard } = await loadNutJsBindings();
    await keyboard.releaseKey(...(await this.resolveKeys(keys)));
  }

  private async resolveKeys(keys: AutomationKey[]): Promise<unknown[]> {
    const { Key } = await loadNutJsBindings();
    return keys.map((key) => {
      const resolvedKey = Key[key];
      if (resolvedKey === undefined) {
        throw new Error(`Unsupported nut.js key: ${key}`);
      }
      return resolvedKey;
    });
  }
}

/**
 * OS-level input automation wrapper with deterministic timing.
 */
export class InputAutomation {
  private coordinateContext: CoordinateContext;
  private readonly logger: Pick<Console, "debug" | "info" | "warn" | "error">;
  private readonly provider: MouseKeyboardProvider;
  private readonly coordinateTranslator: CoordinateTranslator;
  private readonly mouseSpeed: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private randomSeed: number;
  private clickCounter = 0;

  constructor(
    coordinateContext: CoordinateContext,
    coordinateTranslator: CoordinateTranslator,
    logger: Pick<Console, "debug" | "info" | "warn" | "error"> = console,
    provider: MouseKeyboardProvider = new NutJsMouseKeyboardProvider(),
    options: InputAutomationOptions = {}
  ) {
    this.coordinateContext = coordinateContext;
    this.coordinateTranslator = coordinateTranslator;
    this.logger = logger;
    this.provider = provider;
    this.mouseSpeed = options.mouseSpeed ?? DEFAULT_MOUSE_SPEED;
    this.randomSeed = options.randomSeed ?? 0;
    this.sleep = options.sleep ?? (async (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async clickAt(visionX: number, visionY: number): Promise<void> {
    const translated = this.coordinateTranslator.visionToScreenCoords(
      visionX,
      visionY,
      this.coordinateContext.layoutResolution,
      this.coordinateContext.windowBounds,
      this.coordinateContext.dpiCalibration
    );

    if (
      !this.isWithinBounds(
        translated.x,
        translated.y,
        this.coordinateContext.windowBounds,
        this.coordinateContext.dpiCalibration
      )
    ) {
      const message = `Translated coordinates (${translated.x}, ${translated.y}) are outside window bounds`;
      this.logger.error("InputAutomation: Refusing out-of-bounds click", {
        translated,
        windowBounds: this.coordinateContext.windowBounds
      });
      throw new Error(message);
    }

    const delayMs = Math.round(1000 + deterministicRandom(this.randomSeed, this.clickCounter) * 2000);
    this.clickCounter += 1;

    this.logger.debug("InputAutomation: Pre-click delay", { delayMs, translated });
    await this.sleep(delayMs);
    await this.provider.setMouseSpeed(this.mouseSpeed);
    await this.provider.moveMouse(translated);
    await this.provider.leftClick();
  }

  async typeText(text: string): Promise<void> {
    await this.provider.typeText(text);
  }

  async clearTextField(): Promise<void> {
    await this.provider.pressKey("LeftCmd", "A");
    await this.provider.releaseKey("LeftCmd", "A");
    await this.provider.pressKey("Backspace");
    await this.provider.releaseKey("Backspace");
  }

  updateCoordinateContext(context: CoordinateContext): void {
    this.coordinateContext = context;
  }

  updateRandomSeed(seed: number): void {
    if (!Number.isFinite(seed)) {
      return;
    }
    this.randomSeed = seed;
    this.clickCounter = 0;
  }

  private isWithinBounds(
    x: number,
    y: number,
    bounds: WindowBounds,
    dpiCalibration: number
  ): boolean {
    const scale =
      Number.isFinite(dpiCalibration) && dpiCalibration > 0 ? dpiCalibration : 1;
    const minX = bounds.x * scale;
    const maxX = (bounds.x + bounds.width) * scale;
    const minY = bounds.y * scale;
    const maxY = (bounds.y + bounds.height) * scale;
    return x >= minX && x <= maxX && y >= minY && y <= maxY;
  }
}
