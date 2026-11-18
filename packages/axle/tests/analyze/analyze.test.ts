import { describe, expect, test } from "vitest";
import {
  analyze,
  cancelled,
  completed,
  failed,
  flatten,
  named,
  partOf,
  repeats,
  streaks,
  sum,
} from "../../src/analyze.js";
import type { Turn } from "../../src/turns/types.js";
import {
  agentTurn,
  compaction,
  exampleConversation,
  subagent,
  text_,
  timing,
  tool,
  usage,
  userTurn,
} from "./fixtures.js";

describe("analyze", () => {
  describe("lists and scopes", () => {
    test("a turn holds its parts in order, and its lists are those parts by kind", () => {
      const [, turn] = analyze([
        userTurn("u", "go"),
        agentTurn("a", [
          compaction("c", "beforeTurn", "complete"),
          tool("p1", "read-file", { path: "x" }),
          text_("p2", "hello"),
          subagent("p3", "researcher", []),
        ]),
      ]).turns;

      expect(turn!.parts.map((p) => p.kind)).toEqual(["compaction", "tool", "text", "subagent"]);
      expect(turn!.compactions).toEqual([turn!.parts[0]]);
      expect(turn!.tools).toEqual([turn!.parts[1]]);
      expect(turn!.texts).toEqual([turn!.parts[2]]);
      expect(turn!.subagents).toEqual([turn!.parts[3]]);
    });

    test("the same segment is one object wherever it is reached", () => {
      const a = analyze(exampleConversation());
      const turn = a.turns[3]!;

      expect(a.tools[1]).toBe(turn.parts[0]);
      expect(turn.tools[0]).toBe(turn.parts[0]);
      expect(a.errors[0]).toBe(turn.parts[0]);
      expect(a.errors[1]).toBe(a.turns[7]);
      expect(a.turns[7]!.errors[0]).toBe(a.turns[7]);
    });

    test("thinking, citation and file parts produce no segment, and a user turn has none", () => {
      const a = analyze([
        {
          id: "u",
          owner: "user",
          status: "complete",
          parts: [text_("u1", "read this"), { id: "u2", type: "file", file: {} as never }],
        },
        agentTurn("a", [{ id: "a1", type: "thinking", raw: "hmm" }, text_("a2", "ok")]),
      ]);

      expect(a.turns[0]!.parts).toEqual([]);
      expect(a.turns[1]!.parts).toMatchObject([{ kind: "text", partId: "a2", chars: 2 }]);
      expect(a.texts).toHaveLength(1);
    });

    test("a turn's errors are the turn itself when it failed, then its failed parts", () => {
      const [turn] = analyze([
        agentTurn(
          "a",
          [
            tool("p1", "exec", {}, { type: "execution", message: "boom" }),
            compaction("c", "afterTurn", "error", "too long"),
            tool("p2", "exec", {}, { type: "fatal", message: "gone" }),
          ],
          { status: "error", error: { message: "gone", code: "TOOL_FATAL_ERROR" } },
        ),
      ]).turns;

      expect(turn!.errors.map((e) => [e.kind, e.error?.type])).toEqual([
        ["turn", "thrown"],
        ["tool", "execution"],
        ["compaction", "compaction"],
        ["tool", "fatal"],
      ]);
      expect(turn!.errors.every((e) => e.recovered === false)).toBe(true);
    });

    test("deferred and provider tools are tool calls with their own kind and parameters", () => {
      const a = analyze([
        agentTurn("a", [
          {
            id: "p1",
            type: "action",
            kind: "deferred",
            status: "waiting",
            detail: { name: "ask-user", callId: "c1", input: { question: "ok?" } },
          },
          {
            id: "p2",
            type: "action",
            kind: "provider-tool",
            status: "error",
            detail: {
              name: "web_search",
              input: { type: "search", queries: ["axle"] },
              result: { type: "error", error: { type: "failed", message: "no" } },
            },
          },
        ]),
      ]);

      expect(a.tools).toMatchObject([
        {
          kind: "deferred",
          name: "ask-user",
          callId: "c1",
          status: "waiting",
          parameters: { question: "ok?" },
        },
        {
          kind: "provider",
          name: "web_search",
          parameters: { type: "search", queries: ["axle"] },
          error: { type: "failed", message: "no" },
          recovered: true,
        },
      ]);
    });
  });

  describe("subagents", () => {
    const turns = exampleConversation();
    const a = analyze(turns);

    test("are sequestered: a list describes its own run only", () => {
      expect(a.tools.map((t) => t.name)).toEqual(["read-file", "read-file", "read-file", "exec"]);
      expect(a.tools.every((t) => t.depth === 0)).toBe(true);
      expect(a.subagents[1]).toMatchObject({
        kind: "subagent",
        name: "researcher",
        depth: 0,
        parameters: { task: "t6-p2" },
      });
      expect(a.subagents[1]!.turns.map((t) => [t.turnId, t.turnIndex, t.depth])).toEqual([
        ["r2-u", 0, 1],
        ["r2-a", 1, 1],
      ]);
      expect(a.subagents[1]!.tools.map((t) => t.status)).toEqual(["error", "complete"]);
    });

    test("a subagent that failed is one error in its parent, with its own errors inside", () => {
      const nested = analyze([
        agentTurn("a", [
          subagent(
            "p1",
            "researcher",
            [
              agentTurn("child", [], {
                status: "error",
                failure: { kind: "parse", message: "bad" },
              }),
            ],
            { type: "exception", message: "Subagent failed (parse): bad" },
          ),
        ]),
      ]);

      expect(nested.errors).toMatchObject([{ kind: "subagent", error: { type: "exception" } }]);
      expect(nested.subagents[0]!.errors).toMatchObject([
        { kind: "turn", depth: 1, error: { type: "parse", message: "bad" } },
      ]);
    });

    test("flatten folds every level in, each subagent's segments after its call", () => {
      const all = flatten(a);

      expect(all.turns).toEqual(a.turns);
      expect(all.tools.map((t) => `${t.depth}:${t.name}:${t.status}`)).toEqual([
        "0:read-file:complete",
        "0:read-file:error",
        "0:read-file:complete",
        "1:search:complete",
        "1:search:error",
        "1:search:complete",
        "1:search:complete",
        "0:exec:error",
      ]);
      expect(all.texts).toHaveLength(a.texts.length + 3);
      expect(all.errors).toHaveLength(a.errors.length + 1);
      expect(all.tools[4]).toBe(a.subagents[1]!.tools[0]);
    });
  });

  describe("derived fields", () => {
    test("a cancelled turn says whether the timeout or the user cancelled it", () => {
      const a = analyze([
        agentTurn("a1", [tool("p1", "exec", {}, "cancelled")], {
          status: "cancelled",
          cancelReason: { type: "timeout", limitMs: 20 },
        }),
        agentTurn("a2", [], { status: "cancelled" }),
      ]);

      expect(a.turns.map((t) => t.cancelled)).toEqual(["timeout", "user"]);
      expect(a.turns.filter(cancelled)).toHaveLength(2);
      expect(a.tools.filter(cancelled)).toHaveLength(1);
      expect(a.errors).toEqual([]);
    });

    test("a continuation's inline user turn carries the thread it replies in", () => {
      const a = analyze([
        userTurn("u1", "go"),
        agentTurn("a1", []),
        { ...userTurn("u2", "try again"), threadId: "u1" },
        agentTurn("a2", []),
      ]);

      expect(a.turns.map((t) => t.threadId)).toEqual([undefined, undefined, "u1", undefined]);
    });

    test("one send's result is analyzed from its turn alone", () => {
      const result = { turn: exampleConversation()[3]! };

      const a = analyze([result.turn]);

      expect(a.tools.map((t) => t.status)).toEqual(["error", "complete"]);
      expect(a.errors).toMatchObject([{ recovered: true }]);
    });

    test("rescue is false after a cancelled turn and at the start", () => {
      const a = analyze([
        userTurn("u1", "go"),
        agentTurn("a1", [], { status: "cancelled" }),
        userTurn("u2", "again"),
      ]);

      expect(a.turns.map((t) => t.rescue)).toEqual([false, undefined, false]);
    });

    test("timing and usage become start, end, ms and tokens, and are absent without them", () => {
      const a = analyze([
        agentTurn("a1", [], { usage: usage(7, 3), timing: timing(0, 2) }),
        agentTurn("a2", [], { timing: { start: "2026-01-01T00:00:00.000Z" } }),
        agentTurn("a3", []),
      ]);

      expect(a.turns[0]).toMatchObject({ tokens: { in: 7, out: 3 }, ms: 2000 });
      expect(a.turns[1]).toMatchObject({ start: "2026-01-01T00:00:00.000Z" });
      expect(a.turns[1]).not.toHaveProperty("ms");
      expect(a.turns[2]).not.toHaveProperty("tokens");
      expect(a.turns[2]).not.toHaveProperty("start");
    });

    test("a failed turn or part that recorded no error has type unknown", () => {
      const a = analyze([
        agentTurn(
          "a",
          [
            {
              id: "p",
              type: "action",
              kind: "tool",
              status: "error",
              detail: { name: "x", parameters: {} },
            },
          ],
          { status: "error" },
        ),
      ]);

      expect(a.errors.map((e) => e.error)).toEqual([
        { type: "unknown", message: "" },
        { type: "unknown", message: "" },
      ]);
    });
  });

  describe("turns in progress", () => {
    test("pass their status through, and no outcome predicate matches", () => {
      const a = analyze([
        agentTurn("a", [tool("p1", "exec", {}, "running"), compaction("c", "manual", "running")], {
          status: "streaming",
        }),
      ]);

      expect(a.turns[0]!.status).toBe("streaming");
      expect(a.tools[0]!.status).toBe("running");
      for (const predicate of [failed, completed, cancelled]) {
        expect([...a.turns, ...a.turns[0]!.parts].filter(predicate)).toEqual([]);
      }
    });
  });

  describe("predicates", () => {
    test("are safe on the mixed parts list", () => {
      const turn = analyze(exampleConversation()).turns[3]!;

      expect(turn.parts.filter(named("read-file"))).toHaveLength(2);
      expect(turn.parts.findIndex(failed)).toBe(0);
      expect(turn.parts.filter(completed)).toHaveLength(1);
    });
  });

  describe("streaks", () => {
    test("returns runs of two or more, and none for a single match", () => {
      expect(streaks([1, 2, 2, 1, 2, 1, 2, 2, 2], (n) => n === 2)).toEqual([
        [2, 2],
        [2, 2, 2],
      ]);
    });
  });

  describe("repeats", () => {
    test("groups calls by name, parameters and error type, whatever the key order", () => {
      const a = analyze([
        agentTurn("a", [
          tool("p1", "read-file", { path: "x", limit: 1 }, { type: "execution", message: "one" }),
          tool("p2", "read-file", { limit: 1, path: "x" }, { type: "execution", message: "two" }),
          tool("p3", "read-file", { path: "x", limit: 1 }),
          tool("p4", "read-file", { path: "y", limit: 1 }, { type: "execution", message: "one" }),
        ]),
      ]);

      expect(repeats(a.tools).map((group) => group.map((t) => t.partId))).toEqual([["p1", "p2"]]);
    });

    test("groups failed turns by error type and message, and never groups texts", () => {
      const failure = { kind: "api", type: "overloaded", message: "busy" } as const;
      const a = analyze([
        agentTurn("a1", [text_("p1", "same")], { status: "error", failure }),
        agentTurn("a2", [text_("p2", "same")], { status: "error", failure }),
        agentTurn("a3", [], { status: "error", failure: { ...failure, message: "other" } }),
        agentTurn("a4", []),
        agentTurn("a5", []),
      ]);

      expect(repeats(a.turns).map((group) => group.map((t) => t.turnId))).toEqual([["a1", "a2"]]);
      expect(repeats(a.texts)).toEqual([]);
    });
  });

  describe("sum", () => {
    test("counts undefined as 0", () => {
      expect(sum([{ ms: 5 }, {}, { ms: 7 }] as { ms?: number }[], (item) => item.ms)).toBe(12);
    });
  });

  describe("partOf", () => {
    const turns: Turn[] = exampleConversation();
    const a = analyze(turns);

    test("returns the original turn for a turn segment and the original part otherwise", () => {
      expect(partOf(turns, a.turns[3]!)).toBe(turns[3]);
      expect(partOf(turns, a.tools[1]!)).toBe(turns[3]!.parts[0]);
      expect(partOf(turns, a.texts[0]!)).toMatchObject({ type: "text", text: "looks fine" });
    });

    test("finds a segment inside a subagent run", () => {
      const inner = a.subagents[1]!.tools[0]!;

      expect(partOf(turns, inner)).toMatchObject({
        id: "r2-s0",
        detail: { result: { type: "error", error: { message: "no results" } } },
      });
    });

    test("returns undefined for a segment from other turns", () => {
      expect(partOf([], a.tools[0]!)).toBeUndefined();
    });
  });
});
