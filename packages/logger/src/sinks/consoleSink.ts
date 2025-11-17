import { LogLevel, shouldLog, type StructuredLogEvent } from "@poker-bot/shared";
import type { LogSink } from "./types";

interface ConsoleSinkOptions {
  level: LogLevel;
  consoleImpl?: Pick<Console, "debug" | "info" | "warn" | "error">;
}

export function createConsoleSink(options: ConsoleSinkOptions): LogSink {
  const consoleImpl = options.consoleImpl ?? console;
  return {
    name: "console",
    level: options.level,
    async publish(event: StructuredLogEvent) {
      if (!shouldLog(event.level, options.level)) {
        return;
      }
      const payload = JSON.stringify(event);
      switch (event.level) {
        case LogLevel.DEBUG:
          consoleImpl.debug(payload);
          break;
        case LogLevel.WARN:
          consoleImpl.warn(payload);
          break;
        case LogLevel.ERROR:
        case LogLevel.CRITICAL:
          consoleImpl.error(payload);
          break;
        default:
          consoleImpl.info(payload);
      }
    }
  };
}
