#!/usr/bin/env bun
import { execSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync } from "node:fs";
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

// A binary packaged from anything but the clean release tag identifies
// itself as a dev build. `pnpm build` is left unstamped because it is also
// the npm path and runs before the release commit exists.
function buildStamp() {
  const { version } = JSON.parse(readFileSync("package.json", "utf8"));
  let describe;
  try {
    describe = execSync("git describe --tags --always --dirty", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    describe = "unknown";
  }
  if (describe === `v${version}`) return undefined;
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const time = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
  return `${time} from ${describe}`;
}

const stamp = buildStamp();
const result = await Bun.build({
  entrypoints: ["dist/cli.js"],
  compile: { target: values.target, outfile: values.outfile },
  plugins: [stubReactDevtools],
  define: stamp === undefined ? {} : { AXLE_BUILD_STAMP: JSON.stringify(stamp) },
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}
console.log(
  `${values.outfile} (${values.target})${stamp === undefined ? "" : ` dev build ${stamp}`}`,
);

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
