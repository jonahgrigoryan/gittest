module.exports = {
  root: true,
  env: { es2022: true, node: true },
  parser: "@typescript-eslint/parser",
  parserOptions: { project: ["./tsconfig.base.json"], tsconfigRootDir: __dirname },
  plugins: ["@typescript-eslint"],
  extends: ["eslint:recommended", "plugin:@typescript-eslint/recommended", "prettier"],
  ignorePatterns: [
    "dist/",
    "coverage/",
    "results/",
    "logs/",
    "packages/**/dist/**",
    "packages/shared/src/gen/**"
  ],
};