import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@fifthrevision/axle/models": new URL(
        "./packages/axle/src/models.ts",
        import.meta.url,
      ).pathname,
      "@fifthrevision/axle/ui": new URL("./packages/axle/src/ui.ts", import.meta.url).pathname,
      "@fifthrevision/axle": new URL("./packages/axle/src/index.ts", import.meta.url).pathname,
    },
  },
  test: {
    globals: true,
    environment: "node",
    include: ["packages/*/tests/**/*.test.ts"],
    testTimeout: 10000,
    // Global teardown to clean up test-temp directory
    globalSetup: ["packages/axle/tests/globalSetup.ts"],
  },
});
