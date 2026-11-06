import { describe, expect, test } from "vitest";
import * as z from "zod";
import { Instruct } from "../../src/core/Instruct.js";

describe("Instruct toJSON and fromJSON", () => {
  test("round-trips prompt, inputs, files, references, context, vars and metadata", () => {
    const instruct = new Instruct({
      prompt: "Summarize {{topic}}",
      vars: "optional",
      metadata: { source: "web" },
    }).withInputs({ topic: "the report" });
    instruct.addContext("Files: report.pdf", { title: "Manifest" });
    instruct.addFile("inline notes", { name: "notes.txt" });
    instruct.addFile({
      kind: "document",
      mimeType: "application/pdf",
      name: "report.pdf",
      size: 1234,
      source: { type: "ref", ref: { id: "file-1" } },
    });

    const restored = Instruct.fromJSON(JSON.parse(JSON.stringify(instruct)));

    expect(restored.toJSON()).toEqual(instruct.toJSON());
    expect(restored.schema).toBeUndefined();
    expect(restored.files[0].source).toEqual({ type: "ref", ref: { id: "file-1" } });
    expect(restored.toMessage({ id: "m1" }).content).toEqual(
      instruct.toMessage({ id: "m1" }).content,
    );
  });

  test("a schema crosses as JSON Schema and renders the same prompt on the other side", () => {
    const instruct = new Instruct({
      prompt: "Rate it",
      schema: z.object({
        title: z.string().describe("Short title"),
        score: z.number().int().min(0).max(10),
        tags: z.array(z.string()).optional(),
        kind: z.enum(["a", "b"]),
      }),
    });

    const json = JSON.parse(JSON.stringify(instruct));
    const restored = Instruct.fromJSON(json);

    expect(Object.keys(json.schema)).not.toContain("~standard");
    expect(restored.schema).toBeDefined();
    expect(restored.render()).toBe(instruct.render());
    expect(restored.schema?.safeParse({ title: "x", score: 3, kind: "a" }).success).toBe(true);
    expect(restored.schema?.safeParse({ title: "x", score: "3", kind: "a" }).success).toBe(false);
  });

  test("a refinement does not cross: the holder of the Zod schema parses for real", () => {
    const instruct = new Instruct({
      prompt: "Name it",
      schema: z.object({ name: z.string().refine((value) => value.length > 2, "too short") }),
    });

    const restored = Instruct.fromJSON(instruct.toJSON());

    expect(restored.schema?.safeParse({ name: "a" }).success).toBe(true);
    expect(instruct.schema.safeParse({ name: "a" }).success).toBe(false);
  });
});
