import type { Citation, ThinkingContinuity } from "../messages/message.js";
import type { Stats } from "../types.js";
import type { TurnEvent } from "./events.js";
import type { ActionResult, Annotation, TimingInfo, Turn, TurnPart, TurnStatus } from "./types.js";

export interface TurnAccumulatorState<TAnnotation extends Annotation = Annotation> {
  turns: Turn<TAnnotation>[];
  sessionAnnotations?: TAnnotation[];
}

export type UnknownEvent = { type: string };

export type AccumulatableEvent<
  TAnnotation extends Annotation = Annotation,
  THostEvent extends UnknownEvent = UnknownEvent,
> = TurnEvent<TAnnotation> | THostEvent;

export type TurnAccumulatorResult<
  TAnnotation extends Annotation = Annotation,
  THostEvent extends UnknownEvent = UnknownEvent,
> =
  | {
      handled: true;
      state: TurnAccumulatorState<TAnnotation>;
      event: TurnEvent<TAnnotation>;
    }
  | {
      handled: false;
      state: TurnAccumulatorState<TAnnotation>;
      event: THostEvent;
    };

export class TurnAccumulator<
  TAnnotation extends Annotation = Annotation,
  THostEvent extends UnknownEvent = UnknownEvent,
> {
  private _state: TurnAccumulatorState<TAnnotation>;

  constructor(init?: TurnAccumulatorState<TAnnotation>) {
    this._state = {
      turns: init?.turns ?? [],
      sessionAnnotations: init?.sessionAnnotations,
    };
  }

  get state(): TurnAccumulatorState<TAnnotation> {
    return this._state;
  }

  apply(
    event: AccumulatableEvent<TAnnotation, THostEvent>,
  ): TurnAccumulatorResult<TAnnotation, THostEvent> {
    const rawEvent = event as EventRecord;

    switch (event.type) {
      case "session:restore":
        return this.replaceState(
          {
            turns: (rawEvent.turns as Turn<TAnnotation>[] | undefined) ?? [],
            sessionAnnotations: rawEvent.sessionAnnotations as TAnnotation[] | undefined,
          },
          event,
        );

      case "turn:user":
        return this.replaceTurns([...this._state.turns, rawEvent.turn as Turn<TAnnotation>], event);

      case "turn:start": {
        const turn: Turn<TAnnotation> = {
          id: rawEvent.turnId as string,
          owner: "agent",
          parts: [],
          status: "streaming",
          ...((rawEvent.timing as TimingInfo | undefined)
            ? { timing: rawEvent.timing as TimingInfo }
            : {}),
        };
        return this.replaceTurns([...this._state.turns, turn], event);
      }

      case "part:start":
        return this.updateTurn(rawEvent.turnId as string, event, (turn) => ({
          ...turn,
          parts: [...turn.parts, rawEvent.part as TurnPart<TAnnotation>],
        }));

      case "text:delta":
        return this.updatePart(
          rawEvent.turnId as string,
          rawEvent.partId as string,
          event,
          (part) => {
            if (part.type !== "text") return part;
            return { ...part, text: part.text + (rawEvent.delta as string) };
          },
        );

      case "text:citation":
        return this.updatePart(
          rawEvent.turnId as string,
          rawEvent.partId as string,
          event,
          (part) => {
            if (part.type !== "text") return part;
            return {
              ...part,
              citations: [...(part.citations ?? []), rawEvent.citation as Citation],
            };
          },
        );

      case "thinking:delta":
        return this.updatePart(
          rawEvent.turnId as string,
          rawEvent.partId as string,
          event,
          (part) => {
            if (part.type !== "thinking") return part;
            return { ...part, text: (part.text ?? "") + (rawEvent.delta as string) };
          },
        );

      case "thinking:summary-delta":
        return this.updatePart(
          rawEvent.turnId as string,
          rawEvent.partId as string,
          event,
          (part) => {
            if (part.type !== "thinking") return part;
            return { ...part, summary: (part.summary ?? "") + (rawEvent.delta as string) };
          },
        );

      case "thinking:update":
        return this.updatePart(
          rawEvent.turnId as string,
          rawEvent.partId as string,
          event,
          (part) => {
            if (part.type !== "thinking") return part;
            return {
              ...part,
              ...(rawEvent.redacted !== undefined
                ? { redacted: rawEvent.redacted as boolean }
                : {}),
              ...(rawEvent.continuity
                ? { continuity: rawEvent.continuity as ThinkingContinuity }
                : {}),
              ...(rawEvent.providerMetadata
                ? { providerMetadata: rawEvent.providerMetadata as Record<string, unknown> }
                : {}),
            };
          },
        );

      case "part:end":
        return this.updatePart(
          rawEvent.turnId as string,
          rawEvent.partId as string,
          event,
          (part) => ({
            ...part,
            timing: (rawEvent.timing as TimingInfo | undefined) ?? part.timing,
          }),
        );

      case "action:args-delta":
        return this.updatePart(
          rawEvent.turnId as string,
          rawEvent.partId as string,
          event,
          (part) => {
            if (part.type !== "action" || part.kind !== "tool") return part;
            return {
              ...part,
              detail: {
                ...part.detail,
                pendingArgs: rawEvent.accumulated as string,
              },
            };
          },
        );

      case "action:running":
        return this.updatePart(
          rawEvent.turnId as string,
          rawEvent.partId as string,
          event,
          (part) => {
            if (part.type !== "action") return part;
            if (part.kind === "tool") {
              const { pendingArgs: _pendingArgs, ...detail } = part.detail;
              return {
                ...part,
                status: "running",
                detail: rawEvent.parameters
                  ? { ...detail, parameters: rawEvent.parameters as Record<string, unknown> }
                  : detail,
              };
            }
            return { ...part, status: "running" };
          },
        );

      case "action:progress":
        return this.updatePart(
          rawEvent.turnId as string,
          rawEvent.partId as string,
          event,
          (part) => {
            if (part.type !== "action") return part;
            const previous = part.detail.result;
            const content = previous?.type === "in-progress" ? previous.content : "";
            return {
              ...part,
              detail: {
                ...part.detail,
                result: {
                  type: "in-progress",
                  content: content + (rawEvent.chunk as string),
                },
              },
            } as TurnPart<TAnnotation>;
          },
        );

      case "action:complete":
        return this.updatePart(
          rawEvent.turnId as string,
          rawEvent.partId as string,
          event,
          (part) => {
            if (part.type !== "action") return part;
            return {
              ...part,
              status: "complete",
              detail: {
                ...part.detail,
                result: rawEvent.result as ActionResult,
              },
              timing: (rawEvent.timing as TimingInfo | undefined) ?? part.timing,
            } as TurnPart<TAnnotation>;
          },
        );

      case "action:error":
        return this.updatePart(
          rawEvent.turnId as string,
          rawEvent.partId as string,
          event,
          (part) => {
            if (part.type !== "action") return part;
            return {
              ...part,
              status: "error",
              detail: {
                ...part.detail,
                result: {
                  type: "error",
                  error: rawEvent.error as { type: string; message: string },
                },
              },
              timing: (rawEvent.timing as TimingInfo | undefined) ?? part.timing,
            } as TurnPart<TAnnotation>;
          },
        );

      case "turn:end":
        return this.updateTurn(rawEvent.turnId as string, event, (turn) => ({
          ...turn,
          status: rawEvent.status as TurnStatus,
          usage: rawEvent.usage as Stats,
          timing: (rawEvent.timing as TimingInfo | undefined) ?? turn.timing,
        }));

      case "annotation:start":
        return this.addAnnotation(event);

      case "annotation:update":
        return this.replaceAnnotation(event, false);

      case "annotation:end":
        return this.replaceAnnotation(event, true);

      case "error":
        return this.handled(event);

      case "action:child-event":
        return this.updatePart(
          rawEvent.turnId as string,
          rawEvent.partId as string,
          event,
          (part) => {
            if (part.type !== "action" || part.kind !== "agent") return part;
            const childAccumulator = new TurnAccumulator<TAnnotation>({
              turns: part.detail.children,
            });
            const result = childAccumulator.apply(rawEvent.event as TurnEvent<TAnnotation>);
            return {
              ...part,
              detail: {
                ...part.detail,
                children: result.state.turns,
              },
            };
          },
        );

      default:
        return { handled: false, state: this._state, event: event as THostEvent };
    }
  }

  private replaceState(
    state: TurnAccumulatorState<TAnnotation>,
    event: AccumulatableEvent<TAnnotation, THostEvent>,
  ): TurnAccumulatorResult<TAnnotation, THostEvent> {
    this._state = state;
    return this.handled(event);
  }

  private replaceTurns(
    turns: Turn<TAnnotation>[],
    event: AccumulatableEvent<TAnnotation, THostEvent>,
  ): TurnAccumulatorResult<TAnnotation, THostEvent> {
    return this.replaceState({ ...this._state, turns }, event);
  }

  private updateTurn(
    turnId: string,
    event: AccumulatableEvent<TAnnotation, THostEvent>,
    updater: (turn: Turn<TAnnotation>) => Turn<TAnnotation>,
  ): TurnAccumulatorResult<TAnnotation, THostEvent> {
    let updated = false;
    const turns = this._state.turns.map((turn) => {
      if (turn.id !== turnId) return turn;
      const next = updater(turn);
      if (next === turn) return turn;
      updated = true;
      return next;
    });

    if (!updated) return this.handled(event);
    return this.replaceTurns(turns, event);
  }

  private updatePart(
    turnId: string,
    partId: string,
    event: AccumulatableEvent<TAnnotation, THostEvent>,
    updater: (part: TurnPart<TAnnotation>) => TurnPart<TAnnotation>,
  ): TurnAccumulatorResult<TAnnotation, THostEvent> {
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
    event: AccumulatableEvent<TAnnotation, THostEvent>,
  ): TurnAccumulatorResult<TAnnotation, THostEvent> {
    const rawEvent = event as EventRecord;
    const target = rawEvent.target as AnnotationTargetLike | undefined;
    const annotation = normalizeAnnotation(rawEvent.annotation as TAnnotation);
    if (!target || !annotation) return this.handled(event);

    if (target.type === "session") {
      return this.replaceState(
        {
          ...this._state,
          sessionAnnotations: [...(this._state.sessionAnnotations ?? []), annotation],
        },
        event,
      );
    }

    if (target.type === "turn") {
      return this.updateTurn(target.turnId, event, (turn) => ({
        ...turn,
        annotations: [...(turn.annotations ?? []), annotation],
      }));
    }

    if (target.type === "part") {
      return this.updatePart(target.turnId, target.partId, event, (part) => ({
        ...part,
        annotations: [...(part.annotations ?? []), annotation],
      }));
    }

    return this.handled(event);
  }

  private replaceAnnotation(
    event: AccumulatableEvent<TAnnotation, THostEvent>,
    completeWhenMissing: boolean,
  ): TurnAccumulatorResult<TAnnotation, THostEvent> {
    const rawEvent = event as EventRecord;
    const target = rawEvent.target as AnnotationTargetLike | undefined;
    const annotation = normalizeAnnotation(rawEvent.annotation as TAnnotation, completeWhenMissing);
    if (!target || !annotation) return this.handled(event);

    if (target.type === "session") {
      const next = replaceAnnotationInList(this._state.sessionAnnotations, annotation);
      if (!next) return this.handled(event);
      return this.replaceState({ ...this._state, sessionAnnotations: next }, event);
    }

    if (target.type === "turn") {
      return this.updateTurn(target.turnId, event, (turn) => {
        const next = replaceAnnotationInList(turn.annotations, annotation);
        return next ? { ...turn, annotations: next } : turn;
      });
    }

    if (target.type === "part") {
      return this.updatePart(target.turnId, target.partId, event, (part) => {
        const next = replaceAnnotationInList(part.annotations, annotation);
        return next ? { ...part, annotations: next } : part;
      });
    }

    return this.handled(event);
  }

  private handled(
    event: AccumulatableEvent<TAnnotation, THostEvent>,
  ): TurnAccumulatorResult<TAnnotation, THostEvent> {
    return {
      handled: true,
      state: this._state,
      event: event as TurnEvent<TAnnotation>,
    };
  }
}

type AnnotationTargetLike =
  | { type: "session" }
  | { type: "turn"; turnId: string }
  | { type: "part"; turnId: string; partId: string };

type EventRecord = { type: string; [key: string]: unknown };

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
