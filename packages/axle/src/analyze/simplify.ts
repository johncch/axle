import { AxleError } from "../errors/AxleError.js";
import type { ActionPart, Turn, TurnPart } from "../turns/types.js";

type AnyTurn = Turn<any>;

/** One turn reduced to its content. */
export interface SimplifiedTurn {
  owner: "user" | "agent";
  status: "pending" | "streaming" | "complete" | "cancelled" | "error";
  error?: { type: string; message: string };
  parts: SimplifiedPart[];
}

/** One part reduced to its content. */
export type SimplifiedPart =
  | { type: "text"; text: string }
  | { type: "thinking"; text: string }
  | { type: "file"; name: string }
  | {
      type: "tool";
      name: string;
      parameters: unknown;
      result?: unknown;
      error?: { type: string; message: string };
    }
  | {
      type: "subagent";
      name: string;
      parameters: unknown;
      result?: unknown;
      error?: { type: string; message: string };
      turns: SimplifiedTurn[];
    }
  | { type: "compaction"; summary?: string; error?: string };

export interface SimplifyOptions {
  /** Longest string kept, in characters; longer ones are cut and end with `…`. Default 800. */
  maxChars?: number;
}

/**
 * Reduce turns to their content for a person or a model to read: ids,
 * timing, usage, annotations and metadata are removed, and long strings
 * are cut short. See docs/architecture/analyze.md.
 *
 * @experimental
 */
export function simplify(
  turns: readonly AnyTurn[],
  options: SimplifyOptions = {},
): SimplifiedTurn[] {
  const maxChars = options.maxChars ?? 800;
  if (typeof maxChars !== "number" || Number.isNaN(maxChars) || maxChars < 0) {
    throw new AxleError("simplify: maxChars must be a number that is 0 or more", {
      code: "INVALID_OPTIONS",
    });
  }
  return simplifyTurns(turns, maxChars);
}

function simplifyTurns(turns: readonly AnyTurn[], maxChars: number): SimplifiedTurn[] {
  return turns.flatMap((turn): SimplifiedTurn[] => {
    const parts = turn.parts.flatMap((part): SimplifiedPart[] => {
      const simplified = simplifyPart(part, maxChars);
      return simplified ? [simplified] : [];
    });
    const error = turnErrorOf(turn, maxChars);
    if (parts.length === 0 && turn.status !== "error" && turn.status !== "cancelled") return [];
    return [{ owner: turn.owner, status: turn.status, ...(error ? { error } : {}), parts }];
  });
}

function turnErrorOf(
  turn: AnyTurn,
  maxChars: number,
): { type: string; message: string } | undefined {
  if (turn.failure)
    return { type: turn.failure.kind, message: cut(turn.failure.message, maxChars) };
  if (turn.error) return { type: "thrown", message: cut(turn.error.message, maxChars) };
  return undefined;
}

function simplifyPart(part: TurnPart<any>, maxChars: number): SimplifiedPart | undefined {
  switch (part.type) {
    case "text":
      return { type: "text", text: cut(part.text, maxChars) };
    case "thinking": {
      const text = part.summary || part.raw || "";
      return text.trim() ? { type: "thinking", text: cut(text, maxChars) } : undefined;
    }
    case "file":
      return { type: "file", name: part.file.name };
    case "compaction":
      return {
        type: "compaction",
        ...(part.summary ? { summary: cut(part.summary, maxChars) } : {}),
        ...(part.error ? { error: cut(part.error, maxChars) } : {}),
      };
    case "action":
      return simplifyAction(part, maxChars);
    default:
      return undefined;
  }
}

function simplifyAction(part: ActionPart<any>, maxChars: number): SimplifiedPart {
  const result = part.detail.result;
  const outcome = {
    ...(result?.type === "success" && result.content !== undefined
      ? { result: cutDeep(result.content, maxChars) }
      : {}),
    ...(result?.type === "error"
      ? { error: { type: result.error.type, message: cut(result.error.message, maxChars) } }
      : {}),
  };
  if (part.kind === "agent") {
    return {
      type: "subagent",
      name: part.detail.name,
      parameters: cutDeep(part.detail.config ?? {}, maxChars),
      ...outcome,
      turns: simplifyTurns(part.detail.children ?? [], maxChars),
    };
  }
  const parameters = part.kind === "tool" ? part.detail.parameters : part.detail.input;
  return {
    type: "tool",
    name: part.detail.name,
    parameters: cutDeep(parameters ?? {}, maxChars),
    ...outcome,
  };
}

function cut(value: string, maxChars: number): string {
  return value.length > maxChars ? `${value.slice(0, maxChars)}…` : value;
}

function cutDeep(value: unknown, maxChars: number): unknown {
  if (typeof value === "string") return cut(value, maxChars);
  if (Array.isArray(value)) return value.map((item) => cutDeep(item, maxChars));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, inner]) => [key, cutDeep(inner, maxChars)]),
    );
  }
  return value;
}
