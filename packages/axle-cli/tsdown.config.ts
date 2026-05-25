import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/cli.ts", "src/tools/index.ts", "src/memory/index.ts", "src/store/index.ts"],
  publint: true,
  attw: {
    profile: "esm-only",
  },
  fixedExtension: false,
  outExtensions() {
    return { js: ".js" };
  },
  hooks: {
    "build:done": async () => {
      const { chmod } = await import("node:fs/promises");
      await chmod("dist/cli.js", 0o755);
    },
  },
});
