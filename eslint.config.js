import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
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

// Deterministic replacement for the prose review rule: `server/**` runtime modules
// run under Node ESM (and are bundled/typed with `moduleResolution: Bundler`), so
// missing `.js` extensions on relative imports silently pass tsc/esbuild and only
// break under direct Node ESM loading.
const ALLOWED_RELATIVE_EXT_RE = /\.(?:js|mjs|cjs|json)$/;
const dikwPlugin = {
  rules: {
    "server-relative-js-extension": {
      meta: {
        type: "problem",
        docs: {
          description: "Require explicit .js extensions on relative imports in server/** modules",
        },
        schema: [],
      },
      create(context) {
        function checkSource(sourceNode) {
          if (!sourceNode) return;
          let specifier = null;
          if (sourceNode.type === "Literal" && typeof sourceNode.value === "string") {
            specifier = sourceNode.value;
          } else if (
            sourceNode.type === "TemplateLiteral" &&
            sourceNode.expressions.length === 0 &&
            typeof sourceNode.quasis[0]?.value?.cooked === "string"
          ) {
            specifier = sourceNode.quasis[0].value.cooked;
          }
          if (specifier === null) return;
          if (
            specifier !== "." &&
            specifier !== ".." &&
            !specifier.startsWith("./") &&
            !specifier.startsWith("../")
          ) {
            return;
          }
          if (!ALLOWED_RELATIVE_EXT_RE.test(specifier)) {
            context.report({
              node: sourceNode,
              message: `Relative import "${specifier}" in server/** must include an explicit .js extension.`,
            });
          }
        }
        return {
          ImportDeclaration(node) {
            checkSource(node.source);
          },
          ExportNamedDeclaration(node) {
            checkSource(node.source);
          },
          ExportAllDeclaration(node) {
            checkSource(node.source);
          },
          ImportExpression(node) {
            checkSource(node.source);
          },
        };
      },
    },
  },
};

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
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
    files: ["**/*.{ts,tsx,mts,cts}"],
    extends: [tseslint.configs.recommended],
    rules: { "@typescript-eslint/no-unused-vars": noUnusedVars },
  },
  // Plain JS (build/verify scripts): the TS rule isn't active here.
  {
    files: ["**/*.{js,mjs,cjs}", "scripts/harness-doctor"],
    rules: { "no-unused-vars": noUnusedVars },
  },
  // Browser app: React hook correctness + no raw console in the shipped bundle.
  {
    files: [
      "src/**/*.{ts,tsx}",
      "packages/web-client/src/**/*.{ts,tsx}",
      "packages/web-ui/src/**/*.{ts,tsx}",
    ],
    plugins: { "react-hooks": reactHooks },
    languageOptions: { globals: { ...globals.browser } },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "no-console": "error",
    },
  },
  // The entry owns the React root. A component defined there makes
  // @vitejs/plugin-react accept the entry's own HMR updates, and a re-run calls
  // createRoot() on #root a second time. Components live in src/Root.tsx.
  {
    files: ["src/main.tsx"],
    plugins: { "react-refresh": reactRefresh },
    rules: { "react-refresh/only-export-components": "error" },
  },
  // Node-side runtime: sidecar, build/verify scripts, and root config files
  // (`eslint.config.js`, `vite.config.ts`, `playwright.config.ts`). The root
  // `*.js` glob matters because `no-undef` is active for plain JS (tseslint turns
  // it off for .ts), so a future Node global there would otherwise falsely error.
  {
    files: [
      "server/**/*.ts",
      "packages/web-server/src/**/*.ts",
      "scripts/**/*.{mjs,js,mts}",
      "scripts/harness-doctor",
      "tests/package-consumers/**/*.{mjs,mts,ts,tsx}",
      "*.{js,cjs,mjs}",
      "*.config.ts",
    ],
    languageOptions: { globals: { ...globals.node } },
  },
  // Server runtime modules must include explicit `.js` extensions on relative imports.
  {
    files: ["server/**/*.ts"],
    ignores: ["server/**/*.test.ts"],
    plugins: { dikw: dikwPlugin },
    rules: { "dikw/server-relative-js-extension": "error" },
  },
  // Tests run under Node + jsdom/Playwright: mock generators legitimately never
  // yield, and console output is a normal debugging aid.
  {
    files: ["tests/package-consumers/ui/**/*.jsx"],
    languageOptions: {
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser },
    },
    rules: { "no-unused-vars": "off" },
  },
  {
    files: ["**/*.test.{ts,tsx}", "tests/**/*.ts", "tests/package-consumers/ui/**/*.{jsx,mjs}"],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: { "require-yield": "off", "no-console": "off" },
  },
);
