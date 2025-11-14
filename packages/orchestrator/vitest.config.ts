import { defineConfig } from "vitest/config";
import path from "path";

const sharedSrc = path.resolve(__dirname, "../shared/src");

export default defineConfig({
  test: {
    environment: "node"
  },
  resolve: {
    alias: [
      { find: "@poker-bot/agents", replacement: path.resolve(__dirname, "../agents/src") },
      { find: "@poker-bot/executor", replacement: path.resolve(__dirname, "../executor/src") },
      { find: "@poker-bot/logger", replacement: path.resolve(__dirname, "../logger/src") },
      { find: "@poker-bot/shared", replacement: sharedSrc },
      {
        find: /^@poker-bot\/shared\/dist\/(.*)$/,
        replacement: `${sharedSrc}/$1`
      },
      {
        find: /^@poker-bot\/shared\/src\/(.*)$/,
        replacement: `${sharedSrc}/$1`
      }
    ]
  }
});
