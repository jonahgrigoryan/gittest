// Flat config for ESLint v9
import tseslint from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import { fileURLToPath } from "url";
import path from "path";

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const projectTsconfig = path.join(rootDir, "tsconfig.base.json");

export default [
  {
    ignores: [
      "dist/**",
      "coverage/**",
      "results/**",
      "logs/**",
      "packages/**/dist/**",
      "packages/shared/src/gen/**",
      "**/*.d.ts",
    ],
  },
  {
    files: ["**/*.ts"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: [projectTsconfig],
        tsconfigRootDir: rootDir,
        ecmaVersion: "latest",
        sourceType: "module",
      },
    },
    plugins: { "@typescript-eslint": tseslint },
    rules: {
      ...tseslint.configs.recommended.rules,
    },
  },
];
