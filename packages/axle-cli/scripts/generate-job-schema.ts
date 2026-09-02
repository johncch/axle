import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import * as z from "zod";
import { JobConfigSchema } from "../src/cli/configs/schemas.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const outPath = join(repoRoot, "schemas", "v3", "job.yaml");

const jsonSchema = z.toJSONSchema(JobConfigSchema, { target: "draft-7", io: "input" });

const header = [
  "# Generated from packages/axle-cli/src/cli/configs/schemas.ts — do not edit by hand.",
  "# Regenerate with: pnpm run generate:job-schema",
  "",
].join("\n");

await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, header + YAML.stringify({ title: "JobConfig", ...jsonSchema }));
console.log(`Wrote ${outPath}`);
