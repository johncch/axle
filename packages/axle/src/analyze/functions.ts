import type {
  Annotation,
  CompactionPart,
  DeferredAction,
  ProviderToolAction,
  SubagentAction,
  TextPart,
  ToolAction,
  Turn,
  TurnPart,
} from "../turns/types.js";
import type {
  Analysis,
  AnySegment,
  CompactionSegment,
  PartSegment,
  SubagentCallSegment,
  TextSegment,
  ToolCallSegment,
  TurnSegment,
} from "./types.js";

type AnyTurn = Turn<any>;

/** Runs of two or more consecutive items that match. */
export function streaks<T>(list: readonly T[], predicate: (item: T) => boolean): T[][] {
  const runs: T[][] = [];
  let run: T[] = [];
  for (const item of list) {
    if (predicate(item)) {
      run.push(item);
      continue;
    }
    if (run.length > 1) runs.push(run);
    run = [];
  }
  if (run.length > 1) runs.push(run);
  return runs;
}

/**
 * Groups of two or more segments that are the same event repeated: calls
 * with the same name, parameters and error type, or failed turns and
 * compactions with the same error.
 */
export function repeats<T extends AnySegment>(list: readonly T[]): T[][] {
  const groups = new Map<string, T[]>();
  for (const segment of list) {
    const key = repeatKey(segment);
    if (key === undefined) continue;
    const group = groups.get(key);
    if (group) group.push(segment);
    else groups.set(key, [segment]);
  }
  return [...groups.values()].filter((group) => group.length > 1);
}

function repeatKey(segment: AnySegment): string | undefined {
  switch (segment.kind) {
    case "text":
      return undefined;
    case "turn":
    case "compaction":
      return segment.error
        ? stable([segment.kind, segment.error.type, segment.error.message])
        : undefined;
    default:
      return stable([segment.kind, segment.name, segment.parameters, segment.error?.type ?? null]);
  }
}

function stable(value: unknown): string {
  return JSON.stringify(value, (_key, inner: unknown) =>
    inner && typeof inner === "object" && !Array.isArray(inner)
      ? Object.fromEntries(
          Object.entries(inner as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1)),
        )
      : inner,
  );
}

/** The total of `pick(item)` over the list, counting `undefined` as 0. */
export function sum<T>(list: readonly T[], pick: (item: T) => number | undefined): number {
  let total = 0;
  for (const item of list) total += pick(item) ?? 0;
  return total;
}

/**
 * The same six lists with every subagent level folded in. `turns` stays the
 * top-level turns; in the other lists a subagent's segments follow the call
 * that produced them, told apart by `depth`.
 */
export function flatten(analysis: Analysis): Analysis {
  const flat: Analysis = {
    turns: [...analysis.turns],
    tools: [],
    subagents: [],
    compactions: [],
    texts: [],
    errors: [],
  };
  collect(analysis.turns, flat);
  return flat;
}

function collect(turns: readonly TurnSegment[], into: Analysis): void {
  for (const turn of turns) {
    if (turn.status === "error") into.errors.push(turn);
    for (const part of turn.parts) {
      add(part, into);
      if (part.kind === "subagent") collect(part.turns, into);
    }
  }
}

function add(part: PartSegment, into: Analysis): void {
  switch (part.kind) {
    case "text":
      into.texts.push(part);
      return;
    case "compaction":
      into.compactions.push(part);
      break;
    case "subagent":
      into.subagents.push(part);
      break;
    default:
      into.tools.push(part);
  }
  if (part.status === "error") into.errors.push(part);
}

/**
 * The original `Turn` a turn segment was made from, or the original part
 * for any other segment, typed by the segment's kind. Searches subagent
 * runs too.
 */
export function partOf<A extends Annotation>(
  turns: readonly Turn<A>[],
  segment: TurnSegment,
): Turn<A> | undefined;
export function partOf<A extends Annotation>(
  turns: readonly Turn<A>[],
  segment: TextSegment,
): TextPart<A> | undefined;
export function partOf<A extends Annotation>(
  turns: readonly Turn<A>[],
  segment: CompactionSegment,
): CompactionPart<A> | undefined;
export function partOf<A extends Annotation>(
  turns: readonly Turn<A>[],
  segment: SubagentCallSegment,
): SubagentAction<A> | undefined;
export function partOf<A extends Annotation>(
  turns: readonly Turn<A>[],
  segment: ToolCallSegment,
): ToolAction<A> | ProviderToolAction<A> | DeferredAction<A> | undefined;
export function partOf<A extends Annotation>(
  turns: readonly Turn<A>[],
  segment: AnySegment,
): Turn<A> | TurnPart<A> | undefined;
export function partOf(
  turns: readonly AnyTurn[],
  segment: AnySegment,
): AnyTurn | TurnPart<any> | undefined {
  const turn = findTurn(turns, segment.turnId);
  if (!turn || segment.partId === undefined) return turn;
  return turn.parts.find((part) => part.id === segment.partId);
}

function findTurn(turns: readonly AnyTurn[], turnId: string): AnyTurn | undefined {
  for (const turn of turns) {
    if (turn.id === turnId) return turn;
    for (const part of turn.parts) {
      if (part.type !== "action" || part.kind !== "agent") continue;
      const found = findTurn(part.detail.children ?? [], turnId);
      if (found) return found;
    }
  }
  return undefined;
}
