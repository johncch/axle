import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { renderSchemaFiles } from "../../scripts/schema-files.js";

const SCHEMA_DIR = join(import.meta.dirname, "..", "..", "..", "..", "schemas", "v3");

describe("checked-in JSON schemas", () => {
  it.each(renderSchemaFiles())(
    "$file matches the Zod schema (run pnpm run generate:schemas)",
    async ({ file, content }) => {
      expect(await readFile(join(SCHEMA_DIR, file), "utf8")).toBe(content);
    },
  );
});
