import { describe, expect, test } from "vitest";
import type {
  Annotation,
  FileInfo,
  Stats,
  TranscriptApplyResult,
  TranscriptInput,
  Turn,
  TimingInfo,
  TurnMetadata,
} from "../src/ui.js";
import { Transcript } from "../src/ui.js";

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
    const usage: Stats = { in: 1, out: 1 };
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
});
