import { describe, expect, test } from "vitest";
import * as z from "zod";
import type {
  Annotation,
  FileInfo,
  Stats,
  TimingInfo,
  TranscriptApplyResult,
  TranscriptInput,
  Turn,
  TurnMetadata,
} from "../src/ui.js";
import { Instruct, Transcript } from "../src/ui.js";

describe("ui entrypoint", () => {
  test("exports browser-safe turn presentation primitives", () => {
    type AppAnnotation = Annotation<{ score: number }, "eval">;
    const transcript = new Transcript<AppAnnotation>();
    const event: TranscriptInput<AppAnnotation> = {
      type: "turn:start",
      turnId: "t1",
    };

    const result: TranscriptApplyResult<AppAnnotation> = transcript.apply(event);
    const turns: readonly Turn<AppAnnotation>[] = transcript.turns;
    const metadata: TurnMetadata = { source: "example" };
    const usage: Stats = { in: 1, out: 1, breakdown: [] };
    const timing: TimingInfo = { start: "2026-01-01T00:00:00.000Z" };
    const file: FileInfo = {
      kind: "text",
      mimeType: "text/plain",
      name: "note.txt",
      source: { type: "text", content: "hello" },
    };

    expect(result.handled).toBe(true);
    expect(metadata.source).toBe("example");
    expect(turns).toEqual([{ id: "t1", owner: "agent", parts: [], status: "streaming" }]);
    expect(usage.in).toBe(1);
    expect(timing.start).toBe("2026-01-01T00:00:00.000Z");
    expect(file.name).toBe("note.txt");
  });

  test("exports Instruct, so a browser can build what a remote send takes", () => {
    const instruct = new Instruct({ prompt: "Name it", schema: z.object({ title: z.string() }) });

    expect(Instruct.fromJSON(instruct.toJSON()).toJSON()).toEqual(instruct.toJSON());
  });
});
