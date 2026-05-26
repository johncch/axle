import type { Stats } from "../types.js";
import type { FileInfo } from "../utils/file.js";

/**
 * Lifecycle state for a renderable turn.
 *
 * Turns are presentation state. They describe what a consumer can render, not
 * the canonical model conversation state.
 */
export type TurnStatus = "streaming" | "complete" | "cancelled" | "error";

/**
 * Host-owned stable render metadata attached to a turn.
 *
 * Metadata is not model state and has no lifecycle. Use annotations for
 * mutable, async, or explicitly placed UI state.
 */
export type TurnMetadata = Record<string, unknown>;

/**
 * ISO timestamp metadata for a turn, part, action, or annotation.
 */
export interface TimingInfo {
  /** ISO timestamp for when the item started. */
  start: string;
  /** ISO timestamp for when the item finished, when known. */
  end?: string;
}

/**
 * Where an annotation should render relative to its target.
 */
export type AnnotationPlacement = "before" | "after";

/**
 * Lifecycle state for an annotation.
 *
 * Omit this for static/informational annotations that do not have a running or
 * terminal state.
 */
export type AnnotationStatus = "running" | "complete" | "cancelled" | "error";

/**
 * Render metadata attached to a session, turn, or turn part.
 *
 * Annotations let hosts attach out-of-band UI such as sandbox startup, eval
 * results, or deployment state without turning that data into model state.
 *
 * @typeParam TData - Consumer-owned payload for the annotation kind.
 * @typeParam TKind - Discriminator for the annotation kind.
 */
export interface Annotation<TData = unknown, TKind extends string = string> {
  /** Globally unique annotation id. */
  id: string;
  /** Consumer-defined annotation kind, used as a discriminator. */
  kind: TKind;
  /** Human-readable label for generic renderers. */
  label: string;
  /** Render placement relative to the target. Defaults to `"after"` when accumulated. */
  placement?: AnnotationPlacement;
  /** Optional lifecycle state for the annotation. */
  status?: AnnotationStatus;
  /** Consumer-owned annotation payload. */
  data?: TData;
  /** Optional timing metadata. */
  timing?: TimingInfo;
}

/**
 * Renderable presentation state for one user or agent turn.
 *
 * `Turn` is the snapshot counterpart to `TurnEvent`: events describe changes,
 * and turns are the accumulated render state. The model-facing conversation
 * remains `AxleMessage[]`.
 *
 * @typeParam TAnnotation - Annotation union supported by the host renderer.
 */
export interface Turn<TAnnotation extends Annotation = Annotation> {
  /** Stable turn id. */
  id: string;
  /** Whether the turn was produced by the user or the agent. */
  owner: "user" | "agent";
  /** Renderable parts in display order. */
  parts: TurnPart<TAnnotation>[];
  /** Current lifecycle state for the turn. */
  status: TurnStatus;
  /** Annotations attached to the whole turn. */
  annotations?: TAnnotation[];
  /** Stable host-owned render metadata copied from the source message. */
  metadata?: TurnMetadata;
  /** Optional timing metadata. */
  timing?: TimingInfo;
  /** Token usage accumulated for this turn, when available. */
  usage?: Stats;
}

/**
 * Any renderable part within a turn.
 */
export type TurnPart<TAnnotation extends Annotation = Annotation> =
  | TextPart<TAnnotation>
  | FilePart<TAnnotation>
  | ThinkingPart<TAnnotation>
  | ActionPart<TAnnotation>;

/**
 * Assistant or user text content.
 */
export interface TextPart<TAnnotation extends Annotation = Annotation> {
  /** Stable part id. */
  id: string;
  /** Part discriminator. */
  type: "text";
  /** Accumulated text content. */
  text: string;
  /** Annotations attached to this part. */
  annotations?: TAnnotation[];
  /** Optional timing metadata. */
  timing?: TimingInfo;
}

/**
 * File content attached to a user turn.
 */
export interface FilePart<TAnnotation extends Annotation = Annotation> {
  /** Stable part id. */
  id: string;
  /** Part discriminator. */
  type: "file";
  /** File metadata and source reference. */
  file: FileInfo;
  /** Annotations attached to this part. */
  annotations?: TAnnotation[];
  /** Optional timing metadata. */
  timing?: TimingInfo;
}

/**
 * Model thinking or reasoning content when surfaced by the provider.
 */
export interface ThinkingPart<TAnnotation extends Annotation = Annotation> {
  /** Stable part id. */
  id: string;
  /** Part discriminator. */
  type: "thinking";
  /** Accumulated thinking text. */
  text: string;
  /** Optional provider-supplied summary. */
  summary?: string;
  /** Whether the provider marked the thinking content as redacted. */
  redacted?: boolean;
  /** Annotations attached to this part. */
  annotations?: TAnnotation[];
  /** Optional timing metadata. */
  timing?: TimingInfo;
}

/**
 * Shared fields for tool, subagent, and provider-managed actions.
 *
 * @internal
 */
interface ActionPartBase<TAnnotation extends Annotation = Annotation> {
  id: string;
  type: "action";
  kind: string;
  status: "pending" | "running" | "complete" | "cancelled" | "error";
  annotations?: TAnnotation[];
  timing?: TimingInfo;
}

/**
 * Action part for an executable Axle tool call.
 */
export interface ToolAction<
  TAnnotation extends Annotation = Annotation,
> extends ActionPartBase<TAnnotation> {
  /** Action discriminator. */
  kind: "tool";
  /** Tool display and execution details. */
  detail: {
    /** Tool name. */
    name: string;
    /** Parsed tool parameters once execution starts. */
    parameters: Record<string, unknown>;
    /** Accumulated JSON argument text before parameters are parsed. */
    pendingArgs?: string;
    /** Tool result or in-progress output. */
    result?: ActionResult;
  };
}

/**
 * Action part for a nested agent/subagent run.
 */
export interface SubagentAction<
  TAnnotation extends Annotation = Annotation,
> extends ActionPartBase<TAnnotation> {
  /** Action discriminator. */
  kind: "agent";
  /** Subagent display and result details. */
  detail: {
    /** Subagent name. */
    name: string;
    /** Optional subagent configuration shown to renderers. */
    config?: Record<string, unknown>;
    /** Child turns produced by the subagent. */
    children: Turn<TAnnotation>[];
    /** Final subagent result, when available. */
    result?: ActionResult;
  };
}

/**
 * Action part for provider-managed tools such as hosted web search or code
 * execution.
 */
export interface ProviderToolAction<
  TAnnotation extends Annotation = Annotation,
> extends ActionPartBase<TAnnotation> {
  /** Action discriminator. */
  kind: "provider-tool";
  /** Provider tool display and result details. */
  detail: {
    /** Provider tool name. */
    name: string;
    /** Provider-specific input, when surfaced. */
    input?: unknown;
    /** Provider tool result, when surfaced. */
    result?: ActionResult;
  };
}

/**
 * Any action part in a turn.
 */
export type ActionPart<TAnnotation extends Annotation = Annotation> =
  | ToolAction<TAnnotation>
  | SubagentAction<TAnnotation>
  | ProviderToolAction<TAnnotation>;

/**
 * Renderable result for an action.
 */
export type ActionResult =
  | { type: "in-progress"; content: string }
  | { type: "success"; content: unknown }
  | { type: "error"; error: { type: string; message: string } };
