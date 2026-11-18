import { describe, expect, test } from "vitest";
import { simplify } from "../../src/analyze.js";
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

describe("simplify", () => {
  test("keeps what was said and done, in order, and drops ids, timing and usage", () => {
    const turns = exampleConversation().slice(2, 4);

    expect(simplify(turns)).toEqual([
      { owner: "user", status: "complete", parts: [{ type: "text", text: "and auth?" }] },
      {
        owner: "agent",
        status: "complete",
        parts: [
          {
            type: "tool",
            name: "read-file",
            parameters: { path: "src/auth/sesion.ts" },
            error: { type: "execution", message: "ENOENT" },
          },
          { type: "text", text: "wrong path" },
          {
            type: "tool",
            name: "read-file",
            parameters: { path: "src/auth/session.ts" },
            result: "done",
          },
          { type: "text", text: "auth is fine" },
        ],
      },
    ]);
  });

  test("cuts every long string, at any depth inside parameters and results", () => {
    const long = "x".repeat(20);
    const [turn] = simplify(
      [
        agentTurn("a", [
          text_("p1", long),
          {
            id: "p2",
            type: "action",
            kind: "tool",
            status: "complete",
            detail: {
              name: "write-file",
              parameters: { path: "a.ts", body: { lines: [long] } },
              result: { type: "success", content: { stdout: long } },
            },
          },
        ]),
      ],
      { maxChars: 5 },
    );

    expect(turn!.parts).toEqual([
      { type: "text", text: "xxxxx…" },
      {
        type: "tool",
        name: "write-file",
        parameters: { path: "a.ts", body: { lines: ["xxxxx…"] } },
        result: { stdout: "xxxxx…" },
      },
    ]);
  });

  test("cuts at 800 characters by default, and not at all with Infinity", () => {
    const long = "x".repeat(900);
    const turns = [agentTurn("a", [text_("p1", long)])];

    // 800 kept characters plus the ellipsis
    expect((simplify(turns)[0]!.parts[0] as { text: string }).text).toHaveLength(801);
    expect(simplify(turns, { maxChars: Infinity })[0]!.parts[0]).toEqual({
      type: "text",
      text: long,
    });
  });

  test("does not change the turns it reads", () => {
    const turns = exampleConversation();
    const before = structuredClone(turns);

    simplify(turns, { maxChars: 3 });

    expect(turns).toEqual(before);
  });

  test("a failed turn carries its error, whether the provider answered or the send threw", () => {
    const simplified = simplify(exampleConversation().filter((turn) => turn.status === "error"));

    expect(simplified.map((turn) => turn.error)).toEqual([
      { type: "api", message: "socket hang up" },
      { type: "parse", message: "Unexpected token" },
      { type: "thrown", message: "Sandbox terminated" },
      { type: "incomplete", message: "stream ended" },
      { type: "refusal", message: "I can't help with that" },
    ]);
  });

  test("keeps an empty turn that failed or was cancelled, and drops any other", () => {
    const simplified = simplify([
      agentTurn("a1", []),
      agentTurn("a2", [], { status: "cancelled" }),
      agentTurn("a3", [], { status: "error" }),
      agentTurn("a4", [], { status: "streaming" }),
    ]);

    expect(simplified).toEqual([
      { owner: "agent", status: "cancelled", parts: [] },
      { owner: "agent", status: "error", parts: [] },
    ]);
  });

  test("a subagent part holds its own turns in the same shape", () => {
    const [turn] = simplify([
      agentTurn("a", [
        subagent(
          "p1",
          "researcher",
          [userTurn("c1", "look it up"), agentTurn("c2", [tool("c2-p1", "search", { q: "axle" })])],
          { type: "exception", message: "Subagent failed (api): busy" },
        ),
      ]),
    ]);

    expect(turn!.parts).toEqual([
      {
        type: "subagent",
        name: "researcher",
        parameters: { task: "p1" },
        error: { type: "exception", message: "Subagent failed (api): busy" },
        turns: [
          { owner: "user", status: "complete", parts: [{ type: "text", text: "look it up" }] },
          {
            owner: "agent",
            status: "complete",
            parts: [{ type: "tool", name: "search", parameters: { q: "axle" }, result: "done" }],
          },
        ],
      },
    ]);
  });

  test("thinking shows its summary, else its raw text, and is left out when empty", () => {
    const [turn] = simplify([
      agentTurn("a", [
        { id: "p1", type: "thinking", summary: "the plan", raw: "long raw text" },
        { id: "p2", type: "thinking", raw: "only raw" },
        { id: "p3", type: "thinking", raw: "  " },
        { id: "p4", type: "thinking" },
      ]),
    ]);

    expect(turn!.parts).toEqual([
      { type: "thinking", text: "the plan" },
      { type: "thinking", text: "only raw" },
    ]);
  });

  test("files keep their name, compactions their summary or error, citations nothing", () => {
    const turns: Turn[] = [
      {
        id: "u",
        owner: "user",
        status: "complete",
        timing: timing(0, 1),
        usage: usage(1, 1),
        parts: [
          {
            id: "u1",
            type: "file",
            file: {
              kind: "text",
              name: "notes.md",
              mimeType: "text/markdown",
              source: { type: "text", content: "secret" },
            },
          },
        ],
      },
      agentTurn("a", [
        compaction("c1", "beforeTurn", "error", "context too large"),
        {
          id: "c2",
          type: "compaction",
          trigger: "afterTurn",
          status: "complete",
          summary: "so far",
        },
        { id: "c3", type: "citation", citations: [] },
      ]),
    ];

    expect(simplify(turns)).toEqual([
      { owner: "user", status: "complete", parts: [{ type: "file", name: "notes.md" }] },
      {
        owner: "agent",
        status: "complete",
        parts: [
          { type: "compaction", error: "context too large" },
          { type: "compaction", summary: "so far" },
        ],
      },
    ]);
  });

  test("deferred and provider tools read their input as parameters", () => {
    const [turn] = simplify([
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
          status: "complete",
          detail: { name: "web_search", input: { type: "search", queries: ["axle"] } },
        },
      ]),
    ]);

    expect(turn!.parts).toEqual([
      { type: "tool", name: "ask-user", parameters: { question: "ok?" } },
      { type: "tool", name: "web_search", parameters: { type: "search", queries: ["axle"] } },
    ]);
  });

  test("rejects a maxChars that is negative or not a number", () => {
    expect(() => simplify([], { maxChars: -1 })).toThrowError(
      expect.objectContaining({ code: "INVALID_OPTIONS" }),
    );
    expect(() => simplify([], { maxChars: Number.NaN })).toThrowError(
      expect.objectContaining({ code: "INVALID_OPTIONS" }),
    );
  });
});
