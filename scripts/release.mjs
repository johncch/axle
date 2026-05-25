#!/usr/bin/env node
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error("Usage: pnpm run release -- <x.y.z>");
  process.exit(1);
}

try {
  execSync("git diff-index --quiet HEAD --", { stdio: "ignore" });
} catch {
  console.error("Working tree has uncommitted changes. Commit or stash before releasing.");
  process.exit(1);
}

execSync("pnpm test", { stdio: "inherit" });
execSync("pnpm run build", { stdio: "inherit" });

const packagePaths = [
  new URL("../package.json", import.meta.url),
  new URL("../packages/axle/package.json", import.meta.url),
  new URL("../packages/axle-cli/package.json", import.meta.url),
];

for (const path of packagePaths) {
  const pkg = JSON.parse(readFileSync(path, "utf8"));
  pkg.version = version;
  writeFileSync(path, `${JSON.stringify(pkg, null, 2)}\n`);
}

execSync("pnpm install --lockfile-only --no-frozen-lockfile", { stdio: "inherit" });
execSync(
  "git add package.json packages/axle/package.json packages/axle-cli/package.json pnpm-lock.yaml",
  { stdio: "inherit" },
);
execSync(`git commit -m "Release ${version}"`, { stdio: "inherit" });
execSync(`git tag v${version}`, { stdio: "inherit" });

console.log(`Released ${version}. Push with: git push --follow-tags`);
