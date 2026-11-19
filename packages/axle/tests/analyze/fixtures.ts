import type {
  ActionPart,
  CompactionPart,
  TextPart,
  Turn,
  TurnPart,
} from "../../src/turns/types.js";

const BASE = Date.parse("2026-01-01T00:00:00.000Z");

export function timing(startSeconds: number, seconds: number): { start: string; end: string } {
  return {
    start: new Date(BASE + startSeconds * 1000).toISOString(),
    end: new Date(BASE + (startSeconds + seconds) * 1000).toISOString(),
  };
}

export function usage(input: number, output: number): Turn["usage"] {
  return { in: input, out: output, breakdown: [] };
}

export function userTurn(id: string, text: string): Turn {
  return { id, owner: "user", status: "complete", parts: [text_(`${id}-p1`, text)] };
}

export function agentTurn(id: string, parts: TurnPart[], rest: Partial<Turn> = {}): Turn {
  return { id, owner: "agent", status: "complete", parts, ...rest };
}

export function text_(id: string, text: string): TextPart {
  return { id, type: "text", text };
}

type Outcome = "ok" | "cancelled" | "running" | { type: string; message: string };

function resultOf(outcome: Outcome): {
  status: "running" | "complete" | "cancelled" | "error";
  result?: Extract<ActionPart, { kind: "tool" }>["detail"]["result"];
} {
  if (outcome === "ok") return { status: "complete", result: { type: "success", content: "done" } };
  if (outcome === "cancelled") return { status: "cancelled" };
  if (outcome === "running") return { status: "running" };
  return { status: "error", result: { type: "error", error: outcome } };
}

export function tool(
  id: string,
  name: string,
  parameters: Record<string, unknown>,
  outcome: Outcome = "ok",
): ActionPart {
  const { status, result } = resultOf(outcome);
  return { id, type: "action", kind: "tool", status, detail: { name, parameters, result } };
}

export function subagent(
  id: string,
  name: string,
  children: Turn[],
  outcome: Outcome = "ok",
): ActionPart {
  const { status, result } = resultOf(outcome);
  return {
    id,
    type: "action",
    kind: "agent",
    status,
    detail: { name, config: { task: id }, children, result },
  };
}

export function compaction(
  id: string,
  trigger: CompactionPart["trigger"],
  status: CompactionPart["status"],
  error?: string,
): CompactionPart {
  return { id, type: "compaction", trigger, status, ...(error ? { error } : {}) };
}

function researcherRun(id: string, recovers: boolean): Turn[] {
  return [
    userTurn(`${id}-u`, "research this"),
    agentTurn(`${id}-a`, [
      ...(recovers
        ? [tool(`${id}-s0`, "search", { q: "axel" }, { type: "execution", message: "no results" })]
        : []),
      tool(`${id}-s1`, "search", { q: "axle" }),
      text_(`${id}-t`, "found it"),
    ]),
  ];
}

/** The 18-turn conversation from AXL-101. */
export function exampleConversation(): Turn[] {
  return [
    userTurn("t1", "check the session handling"),
    agentTurn("t2", [tool("t2-p1", "read-file", { path: "a.ts" }), text_("t2-p2", "looks fine")], {
      reason: "stop",
      usage: usage(100, 20),
      timing: timing(0, 1),
    }),
    userTurn("t3", "and auth?"),
    agentTurn(
      "t4",
      [
        tool(
          "t4-p1",
          "read-file",
          { path: "src/auth/sesion.ts" },
          { type: "execution", message: "ENOENT" },
        ),
        text_("t4-p2", "wrong path"),
        tool("t4-p3", "read-file", { path: "src/auth/session.ts" }),
        text_("t4-p4", "auth is fine"),
      ],
      { reason: "stop", usage: usage(200, 40), timing: timing(10, 2) },
    ),
    userTurn("t5", "research three things"),
    agentTurn(
      "t6",
      [
        subagent("t6-p1", "researcher", researcherRun("r1", false)),
        subagent("t6-p2", "researcher", researcherRun("r2", true)),
        subagent("t6-p3", "researcher", researcherRun("r3", false)),
        text_("t6-p4", "all done"),
      ],
      { reason: "stop", usage: usage(900, 90), timing: timing(20, 5) },
    ),
    userTurn("t7", "next"),
    agentTurn("t8", [], {
      status: "error",
      failure: { kind: "api", type: "connection_error", message: "socket hang up" },
      usage: usage(50, 0),
      timing: timing(30, 2),
    }),
    userTurn("t9", "continue"),
    agentTurn("t10", [text_("t10-p1", "not json")], {
      status: "error",
      failure: { kind: "parse", message: "Unexpected token" },
      reason: "stop",
      usage: usage(60, 10),
      timing: timing(40, 3),
    }),
    userTurn("t11", "fix the error"),
    agentTurn(
      "t12",
      [tool("t12-p1", "exec", { cmd: "ls" }, { type: "fatal", message: "Sandbox terminated" })],
      {
        status: "error",
        error: { message: "Sandbox terminated", code: "TOOL_FATAL_ERROR" },
        usage: usage(70, 5),
        timing: timing(50, 4),
      },
    ),
    userTurn("t13", "fix it"),
    agentTurn("t14", [], {
      status: "error",
      failure: { kind: "incomplete", type: "IncompleteStream", message: "stream ended" },
      usage: usage(80, 0),
      timing: timing(60, 5),
    }),
    userTurn("t15", "continue"),
    agentTurn("t16", [text_("t16-p1", "done")], {
      reason: "stop",
      usage: usage(90, 9),
      timing: timing(70, 1),
    }),
    userTurn("t17", "do something else"),
    agentTurn("t18", [], {
      status: "error",
      failure: { kind: "refusal", message: "I can't help with that" },
      usage: usage(10, 1),
      timing: timing(80, 1),
    }),
  ];
}
