import YAML from "yaml";
import * as z from "zod";
import { CliConfigSchema, JobConfigSchema } from "../src/cli/configs/schemas.js";

const SOURCES = [
  { file: "job.yaml", title: "JobConfig", schema: JobConfigSchema },
  { file: "config.yaml", title: "CliConfig", schema: CliConfigSchema },
];

const HEADER = [
  "# Generated from packages/axle-cli/src/cli/configs/schemas.ts — do not edit by hand.",
  "# Regenerate with: pnpm run generate:schemas",
  "",
].join("\n");

export interface SchemaFile {
  file: string;
  content: string;
}

export function renderSchemaFiles(): SchemaFile[] {
  return SOURCES.map(({ file, title, schema }) => ({
    file,
    content:
      HEADER +
      YAML.stringify({ title, ...z.toJSONSchema(schema, { target: "draft-7", io: "input" }) }),
  }));
}
