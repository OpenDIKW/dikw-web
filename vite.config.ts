import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { agentSidecarPlugin } from "./server/agent/vitePlugin";
import { webApiPlugin } from "./server/web/vitePlugin";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const target = env.VITE_DIKW_PROXY_TARGET || "http://127.0.0.1:8765";

  return {
    plugins: [react(), agentSidecarPlugin(), webApiPlugin()],
    test: {
      include: [
        "src/**/*.{test,spec}.{ts,tsx}",
        "server/**/*.{test,spec}.ts",
        "scripts/**/*.{test,spec}.mjs",
      ],
      exclude: ["tests/e2e/**", "node_modules/**", "dist/**"],
      environment: "jsdom",
      setupFiles: ["./src/test/setup.ts"],
      coverage: {
        provider: "v8",
        reporter: ["text", "html"],
        reportsDirectory: "coverage",
        include: ["src/**/*.{ts,tsx}"],
        exclude: [
          "src/**/*.test.{ts,tsx}",
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
