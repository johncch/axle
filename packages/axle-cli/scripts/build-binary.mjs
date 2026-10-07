#!/usr/bin/env bun
import { copyFileSync, existsSync, mkdirSync, renameSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    target: { type: "string", default: `bun-${process.platform}-${process.arch}` },
    outfile: { type: "string", default: "dist-bin/axle" },
    install: { type: "string" },
  },
});

if (!existsSync("dist/cli.js")) {
  console.error("dist/cli.js not found. Run `pnpm run build` first.");
  process.exit(1);
}

// ink reaches react-devtools-core through a dynamic import guarded by
// `process.env['DEV']`; Node never evaluates it, but Bun's bundler inlines
// dynamic imports and cannot resolve the uninstalled optional peer.
const stubReactDevtools = {
  name: "stub-react-devtools-core",
  setup(build) {
    build.onResolve({ filter: /^react-devtools-core$/ }, () => ({
      path: "react-devtools-core",
      namespace: "stub",
    }));
    build.onLoad({ filter: /.*/, namespace: "stub" }, () => ({
      contents: "export default {};",
      loader: "js",
    }));
  },
};

const result = await Bun.build({
  entrypoints: ["dist/cli.js"],
  compile: { target: values.target, outfile: values.outfile },
  plugins: [stubReactDevtools],
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}
console.log(`${values.outfile} (${values.target})`);

// Rename rather than overwrite: macOS caches code-signature validity per
// inode, and rewriting a signed executable in place can get the next
// launch killed (golang/go#42684).
if (values.install !== undefined) {
  mkdirSync(values.install, { recursive: true });
  const installed = join(values.install, "axle");
  const staged = `${installed}.tmp`;
  copyFileSync(values.outfile, staged);
  renameSync(staged, installed);
  console.log(`installed ${installed}`);
}
