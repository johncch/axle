import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts", "src/ui.ts", "src/models.ts"],
  publint: true,
  attw: {
    profile: "esm-only",
  },
  fixedExtension: false,
});
