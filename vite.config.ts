import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { createApplicationPlugins } from "@opendikw/web-server/vite";
import { workbenchBoundary } from "./scripts/workbench-boundary";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const target = env.VITE_DIKW_PROXY_TARGET || "http://127.0.0.1:8765";

  return {
    // Tests exercise package source so extracted code remains in coverage.
    // Production builds and the independent tarball fixture use real exports.
    resolve:
      mode === "test"
        ? {
            alias: {
              "@opendikw/web-server/runtime": fileURLToPath(
                new URL("./packages/web-server/src/runtime/index.ts", import.meta.url),
              ),
              ...Object.fromEntries(
                [
                  "core",
                  "agent",
                  "types",
                  "import",
                  "convert",
                  "translate",
                  "document",
                  "connection",
                ].map((entry) => [
                  `@opendikw/web-client/${entry}`,
                  fileURLToPath(
                    new URL(`./packages/web-client/src/${entry}/index.ts`, import.meta.url),
                  ),
                ]),
              ),
              ...Object.fromEntries(
                ["controls", "reader", "hooks", "auth", "theme"].map((entry) => [
                  `@opendikw/web-ui/${entry}`,
                  fileURLToPath(
                    new URL(`./packages/web-ui/src/${entry}/index.ts`, import.meta.url),
                  ),
                ]),
              ),
            },
          }
        : undefined,
    plugins: [react(), ...createApplicationPlugins(), workbenchBoundary()],
    test: {
      include: [
        "src/**/*.{test,spec}.{ts,tsx}",
        "packages/web-client/src/**/*.{test,spec}.{ts,tsx}",
        "packages/web-ui/src/**/*.{test,spec}.{ts,tsx}",
        "server/**/*.{test,spec}.ts",
        "packages/web-server/src/**/*.{test,spec}.ts",
        "scripts/**/*.{test,spec}.mjs",
      ],
      exclude: ["tests/e2e/**", "node_modules/**", "dist/**"],
      environment: "jsdom",
      setupFiles: ["./src/test/setup.ts"],
      coverage: {
        provider: "v8",
        reporter: ["text", "html"],
        reportsDirectory: "coverage",
        include: [
          "src/**/*.{ts,tsx}",
          "packages/web-client/src/**/*.{ts,tsx}",
          "packages/web-ui/src/**/*.{ts,tsx}",
          "packages/web-server/src/runtime/**/*.ts",
        ],
        exclude: [
          "**/*.test.{ts,tsx}",
          "src/test/**",
          "src/main.tsx",
          "src/types.ts",
          "src/vite-env.d.ts",
        ],
        thresholds: {
          statements: 60,
          branches: 45,
          functions: 55,
          lines: 60,
        },
      },
    },
    server: {
      // The Playwright dev server (DIKW_E2E) watches no files, so no edit or
      // package rebuild can hot-update a page while a test runs.
      ...(env.DIKW_E2E ? { watch: null } : {}),
      proxy: {
        "/v1": {
          target,
          changeOrigin: true,
          secure: false,
        },
      },
    },
  };
});
