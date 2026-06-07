import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

// Flat config (ESLint 9). Scope is deliberately the lint layer that TypeScript's
// `strict` mode does NOT already cover: React hook dependency/order correctness,
// unused symbols (tsconfig has no noUnusedLocals), and no raw `console` in the
// shipped browser bundle. Several `eslint-disable-next-line` comments already in
// the tree name these exact rules — this config makes them live.
//
// react-hooks is pinned to its two classic rules (rules-of-hooks +
// exhaustive-deps), NOT the plugin's v7 `recommended` preset: that preset bundles
// opinionated rules (set-state-in-effect, immutability, preserve-manual-
// memoization) that flag working code and would force a non-surgical refactor.
// Type-checked rules are intentionally omitted (slow; `strict` tsc already covers
// the type surface) so this stays a fast, deterministic gate.
const noUnusedVars = [
  "error",
  { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
];

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "dist-server/**",
      "coverage/**",
      "playwright-report/**",
      "test-results/**",
      ".agent-sessions/**",
      ".tmp/**",
    ],
  },
  js.configs.recommended,
  // TypeScript surface: typescript-eslint's recommended (non-type-checked).
  {
    files: ["**/*.{ts,tsx}"],
    extends: [tseslint.configs.recommended],
    rules: { "@typescript-eslint/no-unused-vars": noUnusedVars },
  },
  // Plain JS (build/verify scripts): the TS rule isn't active here.
  {
    files: ["**/*.{js,mjs,cjs}"],
    rules: { "no-unused-vars": noUnusedVars },
  },
  // Browser app: React hook correctness + no raw console in the shipped bundle.
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    languageOptions: { globals: { ...globals.browser } },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "no-console": "error",
    },
  },
  // Node-side runtime: sidecar, build/verify scripts, and root config files
  // (`eslint.config.js`, `vite.config.ts`, `playwright.config.ts`). The root
  // `*.js` glob matters because `no-undef` is active for plain JS (tseslint turns
  // it off for .ts), so a future Node global there would otherwise falsely error.
  {
    files: ["server/**/*.ts", "scripts/**/*.{mjs,js}", "*.{js,cjs,mjs}", "*.config.ts"],
    languageOptions: { globals: { ...globals.node } },
  },
  // Tests run under Node + jsdom/Playwright: mock generators legitimately never
  // yield, and console output is a normal debugging aid.
  {
    files: ["**/*.test.{ts,tsx}", "tests/**/*.ts"],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: { "require-yield": "off", "no-console": "off" },
  },
);
