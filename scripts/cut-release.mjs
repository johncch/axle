#!/usr/bin/env node
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";

const arg = process.argv[2];
if (!arg) {
  console.error("Usage: pnpm run cut-release <major|minor|patch|x.y.z>");
  process.exit(1);
}

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const [maj, min, pat] = pkg.version.split(".").map(Number);

let next;
if (arg === "major") next = `${maj + 1}.0.0`;
else if (arg === "minor") next = `${maj}.${min + 1}.0`;
else if (arg === "patch") next = `${maj}.${min}.${pat + 1}`;
else if (/^\d+\.\d+\.\d+$/.test(arg)) next = arg;
else {
  console.error(`Invalid version or level: ${arg}`);
  console.error("Use major | minor | patch | x.y.z");
  process.exit(1);
}

// npm version requires a clean tree; check up front so we fail fast.
try {
  execSync("git diff-index --quiet HEAD --", { stdio: "ignore" });
} catch {
  console.error("Working tree has uncommitted changes. Commit or stash before releasing.");
  process.exit(1);
}

console.log(`Bumping ${pkg.version} -> ${next}`);

console.log("\n[1/3] Generating changelog...");
execSync(`pnpm start -j ./jobs/changelog.job.yml --args version=${next}`, { stdio: "inherit" });

const rl = createInterface({ input: process.stdin, output: process.stdout });
const answer = await rl.question(
  "\n[2/3] Review CHANGELOG.md. Press y to continue, anything else aborts: ",
);
rl.close();
if (!/^y/i.test(answer.trim())) {
  console.log("Aborted. Changes to CHANGELOG.md are still on disk; revert if needed.");
  process.exit(0);
}

console.log("\n[3/3] Committing changelog and running release...");
execSync(`git add CHANGELOG.md && git commit -m "Update changelog for ${next}"`, {
  stdio: "inherit",
});
execSync(`pnpm run release -- ${next}`, { stdio: "inherit" });

console.log(`\nReleased ${next}. Push with: git push --follow-tags`);
