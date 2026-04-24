import { defineConfig } from "tsdown";

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/cli.ts",
    "src/providers/models.ts",
  ],
  publint: true,
  attw: {
    profile: "esm-only",
  },
  fixedExtension: false,
});
