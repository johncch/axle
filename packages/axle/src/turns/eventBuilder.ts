import type { AxleProviderFailure } from "../execution/helpers.js";
import type { StreamEvent } from "../execution/stream.js";
import type { AxleUserMessage } from "../messages/message.js";
import { AxleStopReason } from "../protocols/types.js";
import type { Stats } from "../types.js";
import { addStats, createStats } from "../utils/stats.js";
import type { TurnEvent } from "./events.js";
import type {
  CitationPart,
  ProviderToolAction,
  SubagentAction,
  TextPart,
  ThinkingPart,
  TimingInfo,
  ToolAction,
  Turn,
  TurnFailure,
  TurnPart,
} from "./types.js";

function finalAnswerReasonOf(
  finishReason: AxleStopReason | undefined,
): "stop" | "length" | undefined {
  switch (finishReason) {
    case AxleStopReason.Stop:
      return "stop";
    case AxleStopReason.Length:
      return "length";
    default:
      return undefined;
  }
}

function startTiming(now = new Date()): TimingInfo {
  return { start: now.toISOString() };
}

function completeTiming(timing: TimingInfo | undefined, now = new Date()): TimingInfo {
  const end = now.toISOString();
  if (!timing) return { start: end, end };

  return {
    ...timing,
    end,
  };
}

function turnFailureOf(failure: AxleProviderFailure): TurnFailure {
  switch (failure.kind) {
    case "api":
      return {
        kind: "api",
        type: failure.type,
        message: failure.message,
        ...(failure.status !== undefined ? { status: failure.status } : {}),
      };
    case "incomplete":
      return { kind: "incomplete", type: failure.type, message: failure.message };
    case "refusal":
      return {
        kind: "refusal",
        message: failure.message,
        ...(failure.text !== undefined ? { text: failure.text } : {}),
        ...(failure.category !== undefined ? { category: failure.category } : {}),
      };
    case "parse":
      return { kind: "parse", message: failure.message };
  }
}

export function userTurnFromMessage(message: AxleUserMessage): Turn {
  const turnId = message.id ?? crypto.randomUUID();
  const parts: TurnPart[] = [];
  const now = new Date();
  const timing = completeTiming(startTiming(now), now);
  const instantTiming = () => ({ ...timing });

  if (typeof message.content === "string") {
    parts.push({
      id: crypto.randomUUID(),
      type: "text",
      text: message.content,
      timing: instantTiming(),
    });
  } else {
    for (const part of message.content) {
      if (part.type === "text") {
        parts.push({
          id: crypto.randomUUID(),
          type: "text",
          text: part.text,
          ...(part.citations ? { citations: part.citations } : {}),
          ...(part.providerMetadata ? { providerMetadata: part.providerMetadata } : {}),
          timing: instantTiming(),
        });
      } else if (part.type === "file") {
        parts.push({
          id: crypto.randomUUID(),
          type: "file",
          file: part.file,
          timing: instantTiming(),
        });
      }
    }
  }

  return {
    id: turnId,
    owner: "user",
    parts,
    status: "complete",
    timing,
    ...(message.metadata ? { metadata: message.metadata } : {}),
  };
}

export class TurnEventBuilder {
  private currentTurnId: string | null = null;
  private currentTurnTiming: TimingInfo | undefined;
  private currentTextPart: { id: string; timing?: TimingInfo } | null = null;
  private currentThinkingPart: { id: string; timing?: TimingInfo } | null = null;
  private openActions = new Map<
    string,
    {
      partId: string;
      turnId: string;
      timing?: TimingInfo;
      name?: string;
      kind?: "tool" | "agent";
    }
  >();
  private accumulatedUsage: Stats = createStats();
  private finalAnswerReason: "stop" | "length" | undefined;

  createUserTurn(message: AxleUserMessage): TurnEvent[] {
    return [{ type: "turn:user", turn: userTurnFromMessage(message) }];
  }

  startAgentTurn(): Extract<TurnEvent, { type: "turn:start" }> {
    const turnId = crypto.randomUUID();
    this.currentTurnId = turnId;
    this.currentTurnTiming = startTiming();
    this.currentTextPart = null;
    this.currentThinkingPart = null;
    this.openActions.clear();
    this.accumulatedUsage = createStats();
    this.finalAnswerReason = undefined;
    return { type: "turn:start", turnId, timing: this.currentTurnTiming };
  }

  handleStreamEvent(event: StreamEvent): TurnEvent[] {
    const turnId = this.currentTurnId;
    if (!turnId) return [];

    const events: TurnEvent[] = [];

    switch (event.type) {
      case "step:start":
        // The stream emits step:start per model request, but the agent
        // presents the entire tool loop as one turn.
        break;

      case "text:start": {
        this.closeOpenParts(events);
        const partId = crypto.randomUUID();
        const part: TextPart = { id: partId, type: "text", text: "", timing: startTiming() };
        this.currentTextPart = { id: partId, timing: part.timing };
        events.push({ type: "part:start", turnId, part });
        break;
      }

      case "text:delta": {
        if (this.currentTextPart) {
          events.push({
            type: "text:delta",
            turnId,
            partId: this.currentTextPart.id,
            delta: event.delta,
          });
        }
        break;
      }

      case "text:end": {
        if (this.currentTextPart) {
          const timing = completeTiming(this.currentTextPart.timing);
          events.push({
            type: "part:end",
            turnId,
            partId: this.currentTextPart.id,
            timing,
          });
          this.currentTextPart = null;
        }
        break;
      }

      case "citation": {
        this.closeOpenParts(events);
        const timing = completeTiming(startTiming());
        const part: CitationPart = {
          id: crypto.randomUUID(),
          type: "citation",
          citations: event.citations,
          ...(event.providerMetadata ? { providerMetadata: event.providerMetadata } : {}),
          timing,
        };
        events.push({ type: "part:start", turnId, part });
        events.push({ type: "part:end", turnId, partId: part.id, timing });
        break;
      }

      case "thinking:start": {
        this.closeOpenParts(events);
        const partId = crypto.randomUUID();
        const part: ThinkingPart = {
          id: partId,
          type: "thinking",
          timing: startTiming(),
          ...(event.continuity ? { continuity: event.continuity } : {}),
          ...(event.providerMetadata ? { providerMetadata: event.providerMetadata } : {}),
        };
        this.currentThinkingPart = { id: partId, timing: part.timing };
        events.push({ type: "part:start", turnId, part });
        break;
      }

      case "thinking:raw-delta": {
        if (this.currentThinkingPart) {
          events.push({
            type: "thinking:raw-delta",
            turnId,
            partId: this.currentThinkingPart.id,
            delta: event.delta,
          });
        }
        break;
      }

      case "text:citation": {
        if (this.currentTextPart) {
          events.push({
            type: "text:citation",
            turnId,
            partId: this.currentTextPart.id,
            citation: event.citation,
          });
        }
        break;
      }

      case "thinking:summary-delta": {
        if (this.currentThinkingPart) {
          events.push({
            type: "thinking:summary-delta",
            turnId,
            partId: this.currentThinkingPart.id,
            delta: event.delta,
          });
        }
        break;
      }

      case "thinking:update": {
        if (this.currentThinkingPart) {
          events.push({
            type: "thinking:update",
            turnId,
            partId: this.currentThinkingPart.id,
            continuity: event.continuity,
            providerMetadata: event.providerMetadata,
          });
        }
        break;
      }

      case "thinking:end": {
        if (this.currentThinkingPart) {
          const timing = completeTiming(this.currentThinkingPart.timing);
          events.push({
            type: "part:end",
            turnId,
            partId: this.currentThinkingPart.id,
            timing,
          });
          this.currentThinkingPart = null;
        }
        break;
      }

      case "tool:request": {
        this.closeOpenParts(events);
        const partId = crypto.randomUUID();
        const timing = startTiming();
        const part: ToolAction | SubagentAction =
          event.kind === "agent"
            ? {
                id: partId,
                type: "action",
                kind: "agent",
                status: "pending",
                timing,
                detail: { name: event.name, children: [] },
              }
            : {
                id: partId,
                type: "action",
                kind: "tool",
                status: "pending",
                timing,
                detail: { name: event.name, parameters: {} },
              };
        this.openActions.set(event.id, {
          partId,
          turnId,
          timing,
          name: event.name,
          kind: event.kind,
        });
        events.push({ type: "part:start", turnId, part });
        break;
      }

      case "tool:args-delta": {
        const mapping = this.openActions.get(event.id);
        if (mapping) {
          events.push({
            type: "action:args-delta",
            turnId,
            partId: mapping.partId,
            delta: event.delta,
            accumulated: event.accumulated,
          });
        }
        break;
      }

      case "tool:exec-start": {
        const mapping = this.openActions.get(event.id);
        if (mapping) {
          events.push({
            type: "action:running",
            turnId,
            partId: mapping.partId,
            parameters: event.parameters,
          });
        }
        break;
      }

      case "tool:exec-delta": {
        const mapping = this.openActions.get(event.id);
        if (mapping) {
          if (typeof event.chunk === "string") {
            events.push({
              type: "action:progress",
              turnId,
              partId: mapping.partId,
              chunk: event.chunk,
            });
          } else if (event.chunk.type === "turn-event") {
            events.push({
              type: "action:child-event",
              turnId,
              partId: mapping.partId,
              event: event.chunk.event,
            });
          }
        }
        break;
      }

      case "tool:exec-complete": {
        const mapping = this.openActions.get(event.id);
        if (mapping) {
          this.openActions.delete(event.id);
          addStats(this.accumulatedUsage, event.usage);
          const timing = completeTiming(mapping.timing);
          if (event.result.type === "success") {
            events.push({
              type: "action:complete",
              turnId,
              partId: mapping.partId,
              result: { type: "success", content: event.result.content },
              timing,
            });
          } else {
            events.push({
              type: "action:error",
              turnId,
              partId: mapping.partId,
              error: event.result.error,
              timing,
            });
          }
        }
        break;
      }

      case "tool:exec-error": {
        const mapping = this.openActions.get(event.id);
        if (mapping) {
          this.openActions.delete(event.id);
          addStats(this.accumulatedUsage, event.usage);
          const timing = completeTiming(mapping.timing);
          if (event.error.type === "aborted") {
            events.push({ type: "action:cancelled", turnId, partId: mapping.partId, timing });
          } else {
            events.push({
              type: "action:error",
              turnId,
              partId: mapping.partId,
              error: event.error,
              timing,
            });
          }
        }
        break;
      }

      case "provider-tool:start": {
        this.closeOpenParts(events);
        const partId = crypto.randomUUID();
        const timing = startTiming();
        const part: ProviderToolAction = {
          id: partId,
          type: "action",
          kind: "provider-tool",
          status: "running",
          timing,
          detail: { name: event.name },
        };
        this.openActions.set(event.id, { partId, turnId, timing });
        events.push({ type: "part:start", turnId, part });
        events.push({ type: "action:running", turnId, partId });
        break;
      }

      case "provider-tool:input": {
        const mapping = this.openActions.get(event.id);
        if (mapping) {
          events.push({
            type: "action:input",
            turnId,
            partId: mapping.partId,
            input: event.input,
          });
        }
        break;
      }

      case "provider-tool:complete": {
        const mapping = this.openActions.get(event.id);
        if (mapping) {
          this.openActions.delete(event.id);
          const timing = completeTiming(mapping.timing);
          events.push({
            type: "action:complete",
            turnId,
            partId: mapping.partId,
            result: {
              type: "success",
              ...(event.output !== undefined ? { content: event.output } : {}),
            },
            timing,
          });
        }
        break;
      }

      case "provider-tool:error": {
        const mapping = this.openActions.get(event.id);
        if (mapping) {
          this.openActions.delete(event.id);
          const timing = completeTiming(mapping.timing);
          events.push({
            type: "action:error",
            turnId,
            partId: mapping.partId,
            error: event.error,
            timing,
          });
        }
        break;
      }

      case "step:complete": {
        this.closeOpenParts(events);
        addStats(this.accumulatedUsage, event.usage);
        this.finalAnswerReason = finalAnswerReasonOf(event.message.finishReason);
        break;
      }

      case "tool-results:start":
      case "tool-results:complete":
      case "error":
        break;
    }

    return events;
  }

  finalizeTurn(
    outcome: "complete" | "cancelled" | "error" = "complete",
    failure?: AxleProviderFailure,
  ): TurnEvent[] {
    const turnId = this.currentTurnId;
    if (!turnId) return [];
    const events: TurnEvent[] = [];
    this.closeOpenParts(events);
    if (outcome !== "complete") {
      for (const action of this.openActions.values()) {
        events.push({
          type: "action:cancelled",
          turnId,
          partId: action.partId,
          timing: completeTiming(action.timing),
        });
      }
    }
    this.openActions.clear();
    const timing = completeTiming(this.currentTurnTiming);
    events.push({
      type: "turn:end",
      turnId,
      status: outcome,
      usage: { ...this.accumulatedUsage },
      ...(failure ? { failure: turnFailureOf(failure) } : {}),
      ...(this.finalAnswerReason ? { reason: this.finalAnswerReason } : {}),
      timing,
    });
    this.currentTurnId = null;
    this.currentTurnTiming = undefined;
    return events;
  }

  private closeOpenParts(events: TurnEvent[]) {
    const turnId = this.currentTurnId;
    if (!turnId) return;

    if (this.currentTextPart) {
      events.push({
        type: "part:end",
        turnId,
        partId: this.currentTextPart.id,
        timing: completeTiming(this.currentTextPart.timing),
      });
      this.currentTextPart = null;
    }
    if (this.currentThinkingPart) {
      events.push({
        type: "part:end",
        turnId,
        partId: this.currentThinkingPart.id,
        timing: completeTiming(this.currentThinkingPart.timing),
      });
      this.currentThinkingPart = null;
    }
  }
}
