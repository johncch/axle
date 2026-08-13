import type { AnnotationEvent, TurnEvent } from "./events.js";
import type { Annotation, Turn, TurnPart } from "./types.js";

export interface TranscriptState<TAnnotation extends Annotation = Annotation> {
  turns: Turn<TAnnotation>[];
}

export type UnknownEvent = { type: string };

export type TranscriptInput<
  TAnnotation extends Annotation = Annotation,
  THostEvent extends UnknownEvent = UnknownEvent,
> = TurnEvent<TAnnotation> | THostEvent;

export type TranscriptApplyResult<
  TAnnotation extends Annotation = Annotation,
  THostEvent extends UnknownEvent = UnknownEvent,
> =
  | {
      handled: true;
      state: TranscriptState<TAnnotation>;
      event: TurnEvent<TAnnotation>;
    }
  | {
      handled: false;
      state: TranscriptState<TAnnotation>;
      event: THostEvent;
    };

/**
 * The complete set of TurnEvent type discriminators. `Record<TurnEvent["type"], true>`
 * makes this compile-checked in both directions: a missing key or an extra
 * key is a type error, so the runtime guard cannot drift from the union.
 */
const TURN_EVENT_TYPES: Record<TurnEvent["type"], true> = {
  "turn:user": true,
  "turn:start": true,
  "turn:end": true,
  "compaction:update": true,
  "compaction:complete": true,
  "compaction:error": true,
  "part:start": true,
  "text:delta": true,
  "text:citation": true,
  "thinking:delta": true,
  "thinking:summary-delta": true,
  "thinking:update": true,
  "part:end": true,
  "action:args-delta": true,
  "action:running": true,
  "action:progress": true,
  "action:complete": true,
  "action:error": true,
  "action:child-event": true,
  "annotation:start": true,
  "annotation:update": true,
  "annotation:end": true,
  error: true,
};

const TURN_EVENT_TYPE_SET = new Set<string>(Object.keys(TURN_EVENT_TYPES));

function isTurnEvent<TAnnotation extends Annotation>(
  event: UnknownEvent,
): event is TurnEvent<TAnnotation> {
  return TURN_EVENT_TYPE_SET.has(event.type);
}

export class Transcript<
  TAnnotation extends Annotation = Annotation,
  THostEvent extends UnknownEvent = UnknownEvent,
> {
  private _state: TranscriptState<TAnnotation>;

  constructor(init?: TranscriptState<TAnnotation>) {
    this._state = {
      turns: init?.turns ?? [],
    };
  }

  get state(): TranscriptState<TAnnotation> {
    return this._state;
  }

  get turns(): Turn<TAnnotation>[] {
    return this._state.turns;
  }

  getTurn(turnId: string): Turn<TAnnotation> | undefined {
    return this._state.turns.find((turn) => turn.id === turnId);
  }

  apply(
    event: TranscriptInput<TAnnotation, THostEvent>,
  ): TranscriptApplyResult<TAnnotation, THostEvent> {
    if (!isTurnEvent<TAnnotation>(event)) {
      return { handled: false, state: this._state, event: event as THostEvent };
    }
    return this.applyTurnEvent(event);
  }

  private applyTurnEvent(
    event: TurnEvent<TAnnotation>,
  ): TranscriptApplyResult<TAnnotation, THostEvent> {
    switch (event.type) {
      case "compaction:update":
        return this.updatePart(event.turnId, event.partId, event, (part) => {
          if (part.type !== "compaction") return part;
          return {
            ...part,
            ...(event.update.summary !== undefined ? { summary: event.update.summary } : {}),
            ...(event.update.progress !== undefined ? { progress: event.update.progress } : {}),
          };
        });

      case "compaction:complete":
        return this.updatePart(event.turnId, event.partId, event, (part) => {
          if (part.type !== "compaction") return part;
          return {
            ...part,
            status: "complete",
            progress: 1,
            ...(event.summary !== undefined ? { summary: event.summary } : {}),
            timing: event.timing ?? part.timing,
          };
        });

      case "compaction:error":
        return this.updatePart(event.turnId, event.partId, event, (part) => {
          if (part.type !== "compaction") return part;
          return {
            ...part,
            status: "error",
            error: event.error,
            timing: event.timing ?? part.timing,
          };
        });

      case "turn:user":
        return this.replaceTurns([...this._state.turns, event.turn], event);

      case "turn:start": {
        const turn: Turn<TAnnotation> = {
          id: event.turnId,
          owner: "agent",
          parts: [],
          status: "streaming",
          ...(event.timing ? { timing: event.timing } : {}),
        };
        return this.replaceTurns([...this._state.turns, turn], event);
      }

      case "part:start":
        return this.updateTurn(event.turnId, event, (turn) => ({
          ...turn,
          parts: [...turn.parts, event.part],
        }));

      case "text:delta":
        return this.updatePart(event.turnId, event.partId, event, (part) => {
          if (part.type !== "text") return part;
          return { ...part, text: part.text + event.delta };
        });

      case "text:citation":
        return this.updatePart(event.turnId, event.partId, event, (part) => {
          if (part.type !== "text") return part;
          return {
            ...part,
            citations: [...(part.citations ?? []), event.citation],
          };
        });

      case "thinking:delta":
        return this.updatePart(event.turnId, event.partId, event, (part) => {
          if (part.type !== "thinking") return part;
          return { ...part, text: (part.text ?? "") + event.delta };
        });

      case "thinking:summary-delta":
        return this.updatePart(event.turnId, event.partId, event, (part) => {
          if (part.type !== "thinking") return part;
          return { ...part, summary: (part.summary ?? "") + event.delta };
        });

      case "thinking:update":
        return this.updatePart(event.turnId, event.partId, event, (part) => {
          if (part.type !== "thinking") return part;
          return {
            ...part,
            ...(event.redacted !== undefined ? { redacted: event.redacted } : {}),
            ...(event.continuity ? { continuity: event.continuity } : {}),
            ...(event.providerMetadata ? { providerMetadata: event.providerMetadata } : {}),
          };
        });

      case "part:end":
        return this.updatePart(event.turnId, event.partId, event, (part) => ({
          ...part,
          timing: event.timing ?? part.timing,
        }));

      case "action:args-delta":
        return this.updatePart(event.turnId, event.partId, event, (part) => {
          if (part.type !== "action" || part.kind !== "tool") return part;
          return {
            ...part,
            detail: {
              ...part.detail,
              pendingArgs: event.accumulated,
            },
          };
        });

      case "action:running":
        return this.updatePart(event.turnId, event.partId, event, (part) => {
          if (part.type !== "action") return part;
          if (part.kind === "tool") {
            const { pendingArgs: _pendingArgs, ...detail } = part.detail;
            return {
              ...part,
              status: "running",
              detail: event.parameters ? { ...detail, parameters: event.parameters } : detail,
            };
          }
          return { ...part, status: "running" };
        });

      case "action:progress":
        return this.updatePart(event.turnId, event.partId, event, (part) => {
          if (part.type !== "action") return part;
          const previous = part.detail.result;
          const content = previous?.type === "in-progress" ? previous.content : "";
          return {
            ...part,
            detail: {
              ...part.detail,
              result: {
                type: "in-progress",
                content: content + event.chunk,
              },
            },
          } as TurnPart<TAnnotation>;
        });

      case "action:complete":
        return this.updatePart(event.turnId, event.partId, event, (part) => {
          if (part.type !== "action") return part;
          return {
            ...part,
            status: "complete",
            detail: {
              ...part.detail,
              result: event.result,
            },
            timing: event.timing ?? part.timing,
          } as TurnPart<TAnnotation>;
        });

      case "action:error":
        return this.updatePart(event.turnId, event.partId, event, (part) => {
          if (part.type !== "action") return part;
          return {
            ...part,
            status: "error",
            detail: {
              ...part.detail,
              result: {
                type: "error",
                error: event.error,
              },
            },
            timing: event.timing ?? part.timing,
          } as TurnPart<TAnnotation>;
        });

      case "turn:end":
        return this.updateTurn(event.turnId, event, (turn) => ({
          ...turn,
          status: event.status,
          usage: event.usage,
          timing: event.timing ?? turn.timing,
        }));

      case "annotation:start":
        return this.addAnnotation(event);

      case "annotation:update":
        return this.replaceAnnotation(event, false);

      case "annotation:end":
        return this.replaceAnnotation(event, true);

      case "error":
        return event.turnId
          ? this.updateTurn(event.turnId, event, (turn) => ({ ...turn, error: event.error }))
          : this.handled(event);

      case "action:child-event":
        return this.updatePart(event.turnId, event.partId, event, (part) => {
          if (part.type !== "action" || part.kind !== "agent") return part;
          const childTranscript = new Transcript<TAnnotation>({
            turns: part.detail.children,
          });
          const result = childTranscript.apply(event.event);
          return {
            ...part,
            detail: {
              ...part.detail,
              children: result.state.turns,
            },
          };
        });

      default: {
        event satisfies never;
        return this.handled(event);
      }
    }
  }

  private replaceState(
    state: TranscriptState<TAnnotation>,
    event: TurnEvent<TAnnotation>,
  ): TranscriptApplyResult<TAnnotation, THostEvent> {
    this._state = state;
    return this.handled(event);
  }

  private replaceTurns(
    turns: Turn<TAnnotation>[],
    event: TurnEvent<TAnnotation>,
  ): TranscriptApplyResult<TAnnotation, THostEvent> {
    return this.replaceState({ ...this._state, turns }, event);
  }

  private updateTurn(
    turnId: string,
    event: TurnEvent<TAnnotation>,
    updater: (turn: Turn<TAnnotation>) => Turn<TAnnotation>,
  ): TranscriptApplyResult<TAnnotation, THostEvent> {
    let updated = false;
    const turns = this._state.turns.map((entry) => {
      if (entry.id !== turnId) return entry;
      const next = updater(entry);
      if (next === entry) return entry;
      updated = true;
      return next;
    });

    if (!updated) return this.handled(event);
    return this.replaceTurns(turns, event);
  }

  private updatePart(
    turnId: string,
    partId: string,
    event: TurnEvent<TAnnotation>,
    updater: (part: TurnPart<TAnnotation>) => TurnPart<TAnnotation>,
  ): TranscriptApplyResult<TAnnotation, THostEvent> {
    return this.updateTurn(turnId, event, (turn) => {
      let updated = false;
      const parts = turn.parts.map((part) => {
        if (part.id !== partId) return part;
        const next = updater(part);
        if (next === part) return part;
        updated = true;
        return next;
      });

      return updated ? { ...turn, parts } : turn;
    });
  }

  private addAnnotation(
    event: AnnotationEvent<TAnnotation> & { type: "annotation:start" },
  ): TranscriptApplyResult<TAnnotation, THostEvent> {
    const target = event.target;
    const annotation = normalizeAnnotation(event.annotation);
    if (!annotation) return this.handled(event);

    if (target.type === "turn") {
      return this.updateTurn(target.turnId, event, (turn) => ({
        ...turn,
        annotations: [...(turn.annotations ?? []), annotation],
      }));
    }

    return this.updatePart(target.turnId, target.partId, event, (part) => ({
      ...part,
      annotations: [...(part.annotations ?? []), annotation],
    }));
  }

  private replaceAnnotation(
    event: AnnotationEvent<TAnnotation> & { type: "annotation:update" | "annotation:end" },
    completeWhenMissing: boolean,
  ): TranscriptApplyResult<TAnnotation, THostEvent> {
    const target = event.target;
    const annotation = normalizeAnnotation(event.annotation, completeWhenMissing);
    if (!annotation) return this.handled(event);

    if (target.type === "turn") {
      return this.updateTurn(target.turnId, event, (turn) => {
        const next = replaceAnnotationInList(turn.annotations, annotation);
        return next ? { ...turn, annotations: next } : turn;
      });
    }

    return this.updatePart(target.turnId, target.partId, event, (part) => {
      const next = replaceAnnotationInList(part.annotations, annotation);
      return next ? { ...part, annotations: next } : part;
    });
  }

  private handled(event: TurnEvent<TAnnotation>): TranscriptApplyResult<TAnnotation, THostEvent> {
    return {
      handled: true,
      state: this._state,
      event,
    };
  }
}

function normalizeAnnotation<TAnnotation extends Annotation>(
  annotation: TAnnotation | undefined,
  completeWhenMissing = false,
): TAnnotation | undefined {
  if (!annotation) return undefined;
  const status = completeWhenMissing ? (annotation.status ?? "complete") : annotation.status;
  const normalized = {
    ...annotation,
    placement: annotation.placement ?? "after",
  };
  return (status ? { ...normalized, status } : normalized) as TAnnotation;
}

function replaceAnnotationInList<TAnnotation extends Annotation>(
  annotations: TAnnotation[] | undefined,
  annotation: TAnnotation,
): TAnnotation[] | undefined {
  if (!annotations) return undefined;
  let replaced = false;
  const next = annotations.map((item) => {
    if (item.id !== annotation.id) return item;
    replaced = true;
    return annotation;
  });
  return replaced ? next : undefined;
}
