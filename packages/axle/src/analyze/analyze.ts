import type {
  ActionPart,
  ActionResult,
  CompactionPart,
  TimingInfo,
  Turn,
  TurnPart,
} from "../turns/types.js";
import type {
  Analysis,
  CompactionSegment,
  PartSegment,
  SegmentError,
  SubagentCallSegment,
  TextSegment,
  ToolCallSegment,
  TurnSegment,
} from "./types.js";

type AnyTurn = Turn<any>;

interface Place {
  turnId: string;
  turnIndex: number;
  depth: number;
  recovered: boolean;
}

/**
 * Reduce turns to segments a program can count, filter and store: one list
 * per kind, in the order things happened, with no content. Pure, and safe
 * on turns still in progress. See docs/architecture/analyze.md.
 *
 * @experimental
 */
export function analyze(turns: readonly AnyTurn[]): Analysis {
  return analyzeRun(turns, 0);
}

function analyzeRun(turns: readonly AnyTurn[], depth: number): Analysis {
  const analysis = emptyAnalysis();
  turns.forEach((turn, turnIndex) => {
    const segment = turnSegment(turn, turnIndex, depth, turns[turnIndex - 1]);
    analysis.turns.push(segment);
    analysis.tools.push(...segment.tools);
    analysis.subagents.push(...segment.subagents);
    analysis.compactions.push(...segment.compactions);
    analysis.texts.push(...segment.texts);
    analysis.errors.push(...segment.errors);
  });
  return analysis;
}

function emptyAnalysis(): Analysis {
  return { turns: [], tools: [], subagents: [], compactions: [], texts: [], errors: [] };
}

function turnSegment(
  turn: AnyTurn,
  turnIndex: number,
  depth: number,
  previous: AnyTurn | undefined,
): TurnSegment {
  const place: Place = { turnId: turn.id, turnIndex, depth, recovered: turn.status === "complete" };
  const parts =
    turn.owner === "agent"
      ? turn.parts.flatMap((part): PartSegment[] => {
          const segment = partSegment(part, place);
          return segment ? [segment] : [];
        })
      : [];
  const failed = turn.status === "error";

  const segment: TurnSegment = {
    kind: "turn",
    turnId: turn.id,
    turnIndex,
    depth,
    owner: turn.owner,
    status: turn.status,
    ...(turn.reason ? { reason: turn.reason } : {}),
    ...(turn.status === "cancelled"
      ? { cancelled: turn.cancelReason ? ("timeout" as const) : ("user" as const) }
      : {}),
    ...(failed ? { error: turnError(turn), recovered: false } : {}),
    ...(turn.owner === "user"
      ? { rescue: previous?.owner === "agent" && previous.status === "error" }
      : {}),
    ...(turn.usage ? { tokens: { in: turn.usage.in, out: turn.usage.out } } : {}),
    ...timingOf(turn.timing),
    parts,
    tools: parts.filter((part) => isToolCall(part)),
    subagents: parts.filter((part) => part.kind === "subagent"),
    compactions: parts.filter((part) => part.kind === "compaction"),
    texts: parts.filter((part) => part.kind === "text"),
    errors: [],
  };
  segment.errors = [
    ...(failed ? [segment] : []),
    ...parts.filter((part): part is Exclude<PartSegment, TextSegment> => isFailed(part)),
  ];
  return segment;
}

function isToolCall(part: PartSegment): part is ToolCallSegment {
  return part.kind === "tool" || part.kind === "deferred" || part.kind === "provider";
}

function isFailed(part: PartSegment): part is Exclude<PartSegment, TextSegment> {
  return part.kind !== "text" && part.status === "error";
}

function turnError(turn: AnyTurn): SegmentError {
  if (turn.failure) return { type: turn.failure.kind, message: turn.failure.message };
  if (turn.error) {
    return {
      type: "thrown",
      message: turn.error.message,
      ...(turn.error.code ? { code: turn.error.code } : {}),
    };
  }
  return { type: "unknown", message: "" };
}

function partSegment(part: TurnPart<any>, place: Place): PartSegment | undefined {
  switch (part.type) {
    case "text":
      return { kind: "text", ...located(part.id, place), chars: part.text.length };
    case "compaction":
      return compactionSegment(part, place);
    case "action":
      return part.kind === "agent" ? subagentSegment(part, place) : toolSegment(part, place);
    default:
      return undefined;
  }
}

function located(
  partId: string,
  place: Place,
): { turnId: string; partId: string; turnIndex: number; depth: number } {
  return { turnId: place.turnId, partId, turnIndex: place.turnIndex, depth: place.depth };
}

function compactionSegment(part: CompactionPart<any>, place: Place): CompactionSegment {
  return {
    kind: "compaction",
    ...located(part.id, place),
    trigger: part.trigger,
    status: part.status,
    ...(part.status === "error"
      ? { error: { type: "compaction", message: part.error ?? "" }, recovered: place.recovered }
      : {}),
    ...timingOf(part.timing),
  };
}

function toolSegment(
  part: Exclude<ActionPart<any>, { kind: "agent" }>,
  place: Place,
): ToolCallSegment {
  return {
    kind: part.kind === "provider-tool" ? "provider" : part.kind,
    ...located(part.id, place),
    name: part.detail.name,
    status: part.status,
    parameters: parametersOf(part),
    ...failureOf(part.status, part.detail.result, place),
    ...timingOf(part.timing),
  };
}

function parametersOf(part: Exclude<ActionPart<any>, { kind: "agent" }>): Record<string, unknown> {
  switch (part.kind) {
    case "tool":
      return part.detail.parameters ?? {};
    case "deferred":
      return part.detail.input ?? {};
    case "provider-tool":
      return (part.detail.input as Record<string, unknown> | undefined) ?? {};
  }
}

function subagentSegment(
  part: Extract<ActionPart<any>, { kind: "agent" }>,
  place: Place,
): SubagentCallSegment {
  return {
    kind: "subagent",
    ...located(part.id, place),
    name: part.detail.name,
    status: part.status,
    parameters: part.detail.config ?? {},
    ...failureOf(part.status, part.detail.result, place),
    ...timingOf(part.timing),
    ...analyzeRun(part.detail.children ?? [], place.depth + 1),
  };
}

function failureOf(
  status: string,
  result: ActionResult | undefined,
  place: Place,
): { error?: SegmentError; recovered?: boolean } {
  if (status !== "error") return {};
  const error =
    result?.type === "error"
      ? { type: result.error.type, message: result.error.message }
      : { type: "unknown", message: "" };
  return { error, recovered: place.recovered };
}

function timingOf(timing: TimingInfo | undefined): { start?: string; end?: string; ms?: number } {
  if (!timing) return {};
  if (!timing.end) return { start: timing.start };
  const ms = Date.parse(timing.end) - Date.parse(timing.start);
  return { start: timing.start, end: timing.end, ...(Number.isFinite(ms) ? { ms } : {}) };
}
