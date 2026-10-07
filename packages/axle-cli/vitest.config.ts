import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@fifthrevision/axle/ui": new URL("../axle/src/ui.ts", import.meta.url).pathname,
      "@fifthrevision/axle": new URL("../axle/src/index.ts", import.meta.url).pathname,
    },
  },
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
    testTimeout: 10000,
  },
});
