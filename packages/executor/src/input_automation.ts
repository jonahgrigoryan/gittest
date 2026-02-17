import { Key, Point, keyboard, mouse, straightTo } from "@nut-tree/nut-js";
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
  pressKey(...keys: Key[]): Promise<void>;
  releaseKey(...keys: Key[]): Promise<void>;
}

export interface InputAutomationOptions {
  mouseSpeed?: number;
  randomSeed?: number;
  sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_MOUSE_SPEED = 1500;

class NutJsMouseKeyboardProvider implements MouseKeyboardProvider {
  setMouseSpeed(speed: number): void {
    mouse.config.mouseSpeed = speed;
  }

  async moveMouse(point: { x: number; y: number }): Promise<void> {
    await mouse.move(straightTo(new Point(Math.round(point.x), Math.round(point.y))));
  }

  async leftClick(): Promise<void> {
    await mouse.leftClick();
  }

  async typeText(text: string): Promise<void> {
    await keyboard.type(text);
  }

  async pressKey(...keys: Key[]): Promise<void> {
    await keyboard.pressKey(...keys);
  }

  async releaseKey(...keys: Key[]): Promise<void> {
    await keyboard.releaseKey(...keys);
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
    await this.provider.pressKey(Key.LeftCmd, Key.A);
    await this.provider.releaseKey(Key.LeftCmd, Key.A);
    await this.provider.pressKey(Key.Backspace);
    await this.provider.releaseKey(Key.Backspace);
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
