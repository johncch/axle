import type { Stats } from "../types.js";
import type { ActionResult, Annotation, TimingInfo, Turn, TurnPart, TurnStatus } from "./types.js";

export type AnnotationTarget =
  | { type: "session" }
  | { type: "turn"; turnId: string }
  | { type: "part"; turnId: string; partId: string };

export type AnnotationEvent<TAnnotation extends Annotation = Annotation> =
  | { type: "annotation:start"; target: AnnotationTarget; annotation: TAnnotation }
  | { type: "annotation:update"; target: AnnotationTarget; annotation: TAnnotation }
  | { type: "annotation:end"; target: AnnotationTarget; annotation: TAnnotation };

export type TurnEvent<TAnnotation extends Annotation = Annotation> =
  // Session
  | {
      type: "session:restore";
      turns: Turn<TAnnotation>[];
      sessionAnnotations?: TAnnotation[];
      config?: Record<string, unknown>;
    }
  // Turn lifecycle
  | { type: "turn:user"; turn: Turn<TAnnotation> }
  | { type: "turn:start"; turnId: string; timing?: TimingInfo }
  | { type: "turn:end"; turnId: string; status: TurnStatus; usage: Stats; timing?: TimingInfo }
  // Part streaming
  | { type: "part:start"; turnId: string; part: TurnPart<TAnnotation> }
  | { type: "text:delta"; turnId: string; partId: string; delta: string }
  | { type: "thinking:delta"; turnId: string; partId: string; delta: string }
  | { type: "part:end"; turnId: string; partId: string; timing?: TimingInfo }
  // Action lifecycle
  | {
      type: "action:args-delta";
      turnId: string;
      partId: string;
      delta: string;
      accumulated: string;
    }
  | { type: "action:running"; turnId: string; partId: string; parameters?: Record<string, unknown> }
  | { type: "action:progress"; turnId: string; partId: string; chunk: string }
  | {
      type: "action:complete";
      turnId: string;
      partId: string;
      result: ActionResult;
      timing?: TimingInfo;
    }
  | {
      type: "action:error";
      turnId: string;
      partId: string;
      error: { type: string; message: string };
      timing?: TimingInfo;
    }
  // Nesting
  | { type: "action:child-event"; turnId: string; partId: string; event: TurnEvent<TAnnotation> }
  // Annotations
  | AnnotationEvent<TAnnotation>
  // Error
  | { type: "error"; error: { type: string; message: string } };
