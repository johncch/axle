import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts", "src/cli.ts"],
  publint: true,
  attw: {
    profile: "esm-only",
  },
  fixedExtension: false,
});
