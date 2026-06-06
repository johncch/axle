import type { AxleUserMessage } from "../messages/message.js";
import type { StreamEvent } from "../providers/stream.js";
import type { Stats } from "../types.js";
import { addStats, createStats } from "../utils/stats.js";
import type { TurnEvent } from "./events.js";
import type {
  CitationPart,
  ProviderToolAction,
  TextPart,
  ThinkingPart,
  TimingInfo,
  ToolAction,
  Turn,
  TurnPart,
} from "./types.js";

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

export class TurnEventBuilder {
  private currentTurnId: string | null = null;
  private currentTurnTiming: TimingInfo | undefined;
  private currentTextPart: { id: string; timing?: TimingInfo } | null = null;
  private currentThinkingPart: { id: string; timing?: TimingInfo } | null = null;
  private toolIdMap = new Map<string, { partId: string; turnId: string; timing?: TimingInfo }>();
  private accumulatedUsage: Stats = createStats();

  createUserTurn(message: AxleUserMessage): TurnEvent[] {
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

    const turn: Turn = {
      id: turnId,
      owner: "user",
      parts,
      status: "complete",
      timing,
      ...(message.metadata ? { metadata: message.metadata } : {}),
    };
    return [{ type: "turn:user", turn }];
  }

  startAgentTurn(): Extract<TurnEvent, { type: "turn:start" }> {
    const turnId = crypto.randomUUID();
    this.currentTurnId = turnId;
    this.currentTurnTiming = startTiming();
    this.currentTextPart = null;
    this.currentThinkingPart = null;
    this.toolIdMap.clear();
    this.accumulatedUsage = createStats();
    return { type: "turn:start", turnId, timing: this.currentTurnTiming };
  }

  handleStreamEvent(event: StreamEvent): TurnEvent[] {
    const turnId = this.currentTurnId;
    if (!turnId) return [];

    const events: TurnEvent[] = [];

    switch (event.type) {
      case "turn:start":
        // stream emits turn:start per provider round-trip, but the
        // agent presents the entire tool loop as one turn.
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
          text: "",
          timing: startTiming(),
          ...(event.redacted !== undefined ? { redacted: event.redacted } : {}),
          ...(event.continuity ? { continuity: event.continuity } : {}),
          ...(event.providerMetadata ? { providerMetadata: event.providerMetadata } : {}),
        };
        this.currentThinkingPart = { id: partId, timing: part.timing };
        events.push({ type: "part:start", turnId, part });
        break;
      }

      case "thinking:delta": {
        if (this.currentThinkingPart) {
          events.push({
            type: "thinking:delta",
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
            redacted: event.redacted,
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
        const part: ToolAction = {
          id: partId,
          type: "action",
          kind: "tool",
          status: "pending",
          timing,
          detail: { name: event.name, parameters: {} },
        };
        this.toolIdMap.set(event.id, { partId, turnId, timing });
        events.push({ type: "part:start", turnId, part });
        break;
      }

      case "tool:args-delta": {
        const mapping = this.toolIdMap.get(event.id);
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
        const mapping = this.toolIdMap.get(event.id);
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
        const mapping = this.toolIdMap.get(event.id);
        if (mapping) {
          events.push({
            type: "action:progress",
            turnId,
            partId: mapping.partId,
            chunk: event.chunk,
          });
        }
        break;
      }

      case "tool:exec-complete": {
        const mapping = this.toolIdMap.get(event.id);
        if (mapping) {
          const timing = completeTiming(mapping.timing);
          mapping.timing = timing;
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
        this.toolIdMap.set(event.id, { partId, turnId, timing });
        events.push({ type: "part:start", turnId, part });
        events.push({ type: "action:running", turnId, partId });
        break;
      }

      case "provider-tool:complete": {
        const mapping = this.toolIdMap.get(event.id);
        if (mapping) {
          const timing = completeTiming(mapping.timing);
          mapping.timing = timing;
          events.push({
            type: "action:complete",
            turnId,
            partId: mapping.partId,
            result: { type: "success", content: event.output },
            timing,
          });
        }
        break;
      }

      case "turn:complete": {
        this.closeOpenParts(events);
        addStats(this.accumulatedUsage, event.usage);
        break;
      }

      case "tool-results:start":
      case "tool-results:complete":
        break;

      case "error": {
        const error = event.error;
        const msg =
          error.kind === "model"
            ? error.error.error.message
            : error.kind === "tool"
              ? `Tool error (${error.error.name}): ${error.error.message}`
              : `Parse error: ${error.message}`;
        events.push({
          type: "error",
          error: { type: error.kind, message: msg },
        });
        break;
      }
    }

    return events;
  }

  finalizeTurn(outcome: "complete" | "cancelled" | "error" = "complete"): TurnEvent[] {
    const turnId = this.currentTurnId;
    if (!turnId) return [];
    const events: TurnEvent[] = [];
    this.closeOpenParts(events);
    const timing = completeTiming(this.currentTurnTiming);
    events.push({
      type: "turn:end",
      turnId,
      status: outcome,
      usage: { ...this.accumulatedUsage },
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
