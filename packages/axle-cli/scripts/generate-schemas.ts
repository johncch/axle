import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderSchemaFiles } from "./schema-files.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const outDir = join(repoRoot, "schemas", "v3");

await mkdir(outDir, { recursive: true });
for (const { file, content } of renderSchemaFiles()) {
  const outPath = join(outDir, file);
  await writeFile(outPath, content);
  console.log(`Wrote ${outPath}`);
}
