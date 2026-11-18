import { describe, expect, test } from "vitest";
import {
  analyze,
  byAgent,
  byUser,
  cancelled,
  completed,
  failed,
  flatten,
  repeats,
  streaks,
  sum,
} from "../../src/analyze.js";
import { exampleConversation } from "./fixtures.js";

describe("the 18 questions of AXL-101, over the example conversation", () => {
  const a = analyze(exampleConversation());
  const all = flatten(a);
  const ids = (segments: { turnId: string }[]): string[] => segments.map((s) => s.turnId);

  test("1. how many turns did it take", () => {
    expect(a.turns).toHaveLength(18);
  });

  test("2. how many completed successfully", () => {
    expect(ids(a.turns.filter(byAgent).filter(completed))).toEqual(["t2", "t4", "t6", "t16"]);
  });

  test("3. why did the others not complete", () => {
    expect(a.turns.filter(failed).map((t) => t.error?.type)).toEqual([
      "api",
      "parse",
      "thrown",
      "incomplete",
      "refusal",
    ]);
    expect(a.turns.find((t) => t.turnId === "t12")?.error).toEqual({
      type: "thrown",
      message: "Sandbox terminated",
      code: "TOOL_FATAL_ERROR",
    });
  });

  test("4. which tool errors were recovered from", () => {
    expect(a.tools.filter(failed).filter((t) => t.recovered)).toMatchObject([
      { turnId: "t4", name: "read-file", parameters: { path: "src/auth/sesion.ts" } },
    ]);
  });

  test("5. which tool errors were not", () => {
    expect(a.tools.filter(failed).filter((t) => !t.recovered)).toMatchObject([
      { turnId: "t12", name: "exec", error: { type: "fatal" } },
    ]);
  });

  test("6. what types of error came up across the whole conversation", () => {
    expect([...new Set(all.errors.map((e) => e.error?.type))]).toEqual([
      "execution",
      "api",
      "parse",
      "thrown",
      "fatal",
      "incomplete",
      "refusal",
    ]);
  });

  test("7. which errors did the model recover from by itself, within the turn", () => {
    expect(ids(all.errors.filter((e) => e.recovered))).toEqual(["t4", "r2-a"]);
  });

  test("8. which needed the user, with a following turn", () => {
    const rescued = a.turns.filter((t) => t.rescue).map((t) => a.turns[t.turnIndex - 1]!);
    expect(ids(rescued)).toEqual(["t8", "t10", "t12", "t14"]);
  });

  test("9. how many user turns were rescues", () => {
    expect(ids(a.turns.filter(byUser).filter((t) => t.rescue))).toEqual([
      "t9",
      "t11",
      "t13",
      "t15",
    ]);
  });

  test("10. how did it end", () => {
    expect(a.turns.at(-1)).toMatchObject({ status: "error", error: { type: "refusal" } });
  });

  test("11. when did things first go wrong", () => {
    expect(a.errors[0]).toMatchObject({ turnId: "t4", turnIndex: 3 });
  });

  test("12. were there streaks of failed turns", () => {
    expect(streaks(a.turns.filter(byAgent), failed).map(ids)).toEqual([
      ["t8", "t10", "t12", "t14"],
    ]);
  });

  test("13. did the same error repeat", () => {
    expect(repeats(all.errors)).toEqual([]);
  });

  test("14. which tools fail, and how often", () => {
    const counts: Record<string, number> = {};
    for (const call of all.tools.filter(failed)) counts[call.name] = (counts[call.name] ?? 0) + 1;
    expect(counts).toEqual({ "read-file": 1, search: 1, exec: 1 });
  });

  test("15. how many subagents ran, and how did they end", () => {
    expect(a.subagents).toHaveLength(3);
    expect(a.subagents.every(completed)).toBe(true);
    expect(a.subagents.map((s) => s.errors.filter((e) => e.recovered).length)).toEqual([0, 1, 0]);
  });

  test("16. how many tokens went to failed turns", () => {
    const lost = a.turns.filter(failed);
    expect(sum(lost, (t) => t.tokens?.in)).toBe(270);
    expect(sum(lost, (t) => t.tokens?.out)).toBe(16);
  });

  test("17. how much time was lost to failures", () => {
    expect(sum(a.turns.filter(failed), (t) => t.ms)).toBe(15_000);
  });

  test("18. how many times did the user cancel", () => {
    expect(a.turns.filter(cancelled).filter((t) => t.cancelled === "user")).toHaveLength(0);
  });
});
