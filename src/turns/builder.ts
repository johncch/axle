import type { AxleUserMessage } from "../messages/message.js";
import type { StreamEvent } from "../providers/stream.js";
import type { Stats } from "../types.js";
import type { AgentEvent } from "./events.js";
import type {
  InternalToolAction,
  TimingInfo,
  TextPart,
  ThinkingPart,
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

export class TurnBuilder {
  private currentTurn: Turn | null = null;
  private currentTextPart: TextPart | null = null;
  private currentThinkingPart: ThinkingPart | null = null;
  private toolIdMap = new Map<string, { partId: string; turnId: string }>();
  private accumulatedUsage: Stats = { in: 0, out: 0 };

  createUserTurn(message: AxleUserMessage): { turn: Turn; events: AgentEvent[] } {
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

    const turn: Turn = { id: turnId, owner: "user", parts, status: "complete", timing };
    return { turn, events: [{ type: "turn:user", turn }] };
  }

  startAgentTurn(): { turn: Turn; events: AgentEvent[] } {
    const turnId = crypto.randomUUID();
    const turn: Turn = {
      id: turnId,
      owner: "agent",
      parts: [],
      status: "streaming",
      timing: startTiming(),
    };
    this.currentTurn = turn;
    this.currentTextPart = null;
    this.currentThinkingPart = null;
    this.toolIdMap.clear();
    this.accumulatedUsage = { in: 0, out: 0 };
    return { turn, events: [{ type: "turn:start", turnId }] };
  }

  handleStreamEvent(event: StreamEvent): AgentEvent[] {
    const turn = this.currentTurn;
    if (!turn) return [];

    const events: AgentEvent[] = [];

    switch (event.type) {
      case "turn:start":
        // stream emits turn:start per provider round-trip, but the
        // builder treats the entire tool loop as one agent turn.
        break;

      case "text:start": {
        this.closeOpenParts(turn, events);
        const partId = crypto.randomUUID();
        const part: TextPart = { id: partId, type: "text", text: "", timing: startTiming() };
        turn.parts.push(part);
        this.currentTextPart = part;
        events.push({ type: "part:start", turnId: turn.id, part: { ...part } });
        break;
      }

      case "text:delta": {
        if (this.currentTextPart) {
          this.currentTextPart.text = event.accumulated;
          events.push({
            type: "text:delta",
            turnId: turn.id,
            partId: this.currentTextPart.id,
            delta: event.delta,
          });
        }
        break;
      }

      case "text:end": {
        if (this.currentTextPart) {
          this.currentTextPart.text = event.final;
          this.currentTextPart.timing = completeTiming(this.currentTextPart.timing);
          events.push({
            type: "part:end",
            turnId: turn.id,
            partId: this.currentTextPart.id,
            timing: this.currentTextPart.timing,
          });
          this.currentTextPart = null;
        }
        break;
      }

      case "thinking:start": {
        this.closeOpenParts(turn, events);
        const partId = crypto.randomUUID();
        const part: ThinkingPart = {
          id: partId,
          type: "thinking",
          text: "",
          timing: startTiming(),
        };
        turn.parts.push(part);
        this.currentThinkingPart = part;
        events.push({ type: "part:start", turnId: turn.id, part: { ...part } });
        break;
      }

      case "thinking:delta": {
        if (this.currentThinkingPart) {
          this.currentThinkingPart.text = event.accumulated;
          events.push({
            type: "thinking:delta",
            turnId: turn.id,
            partId: this.currentThinkingPart.id,
            delta: event.delta,
          });
        }
        break;
      }

      case "thinking:end": {
        if (this.currentThinkingPart) {
          this.currentThinkingPart.text = event.final;
          this.currentThinkingPart.timing = completeTiming(this.currentThinkingPart.timing);
          events.push({
            type: "part:end",
            turnId: turn.id,
            partId: this.currentThinkingPart.id,
            timing: this.currentThinkingPart.timing,
          });
          this.currentThinkingPart = null;
        }
        break;
      }

      case "tool:request": {
        this.closeOpenParts(turn, events);
        const partId = crypto.randomUUID();
        const part: ToolAction = {
          id: partId,
          type: "action",
          kind: "tool",
          status: "pending",
          timing: startTiming(),
          detail: { name: event.name, parameters: {} },
        };
        turn.parts.push(part);
        this.toolIdMap.set(event.id, { partId, turnId: turn.id });
        events.push({
          type: "part:start",
          turnId: turn.id,
          part: { ...part, detail: { ...part.detail } },
        });
        break;
      }

      case "tool:exec-start": {
        const mapping = this.toolIdMap.get(event.id);
        if (mapping) {
          const part = this.findActionPart(turn, mapping.partId) as ToolAction | undefined;
          if (part) {
            part.status = "running";
            part.detail.parameters = event.parameters;
            events.push({
              type: "action:running",
              turnId: turn.id,
              partId: mapping.partId,
              parameters: event.parameters,
            });
          }
        }
        break;
      }

      case "tool:exec-complete": {
        const mapping = this.toolIdMap.get(event.id);
        if (mapping) {
          const part = this.findActionPart(turn, mapping.partId) as ToolAction | undefined;
          if (part) {
            if (event.result.type === "success") {
              part.status = "complete";
              part.timing = completeTiming(part.timing);
              part.detail.result = { type: "success", content: event.result.content };
              events.push({
                type: "action:complete",
                turnId: turn.id,
                partId: mapping.partId,
                result: part.detail.result,
              });
            } else {
              part.status = "error";
              part.timing = completeTiming(part.timing);
              part.detail.result = { type: "error", error: event.result.error };
              events.push({
                type: "action:error",
                turnId: turn.id,
                partId: mapping.partId,
                error: event.result.error,
              });
            }
          }
        }
        break;
      }

      case "internal-tool:start": {
        this.closeOpenParts(turn, events);
        const partId = crypto.randomUUID();
        const part: InternalToolAction = {
          id: partId,
          type: "action",
          kind: "internal-tool",
          status: "running",
          timing: startTiming(),
          detail: { name: event.name },
        };
        turn.parts.push(part);
        this.toolIdMap.set(event.id, { partId, turnId: turn.id });
        events.push({
          type: "part:start",
          turnId: turn.id,
          part: { ...part, detail: { ...part.detail } },
        });
        events.push({ type: "action:running", turnId: turn.id, partId });
        break;
      }

      case "internal-tool:complete": {
        const mapping = this.toolIdMap.get(event.id);
        if (mapping) {
          const part = this.findActionPart(turn, mapping.partId) as InternalToolAction | undefined;
          if (part) {
            part.status = "complete";
            part.timing = completeTiming(part.timing);
            part.detail.result = { type: "success", content: event.output };
            events.push({
              type: "action:complete",
              turnId: turn.id,
              partId: mapping.partId,
              result: part.detail.result,
            });
          }
        }
        break;
      }

      case "turn:complete": {
        this.closeOpenParts(turn, events);
        const stepUsage = event.usage ?? { in: 0, out: 0 };
        this.accumulatedUsage.in += stepUsage.in;
        this.accumulatedUsage.out += stepUsage.out;
        break;
      }

      case "tool-results:start":
      case "tool-results:complete":
        break;

      case "error": {
        const error = event.error;
        const msg =
          error.type === "model"
            ? error.error.error.message
            : `Tool error (${error.error.name}): ${error.error.message}`;
        events.push({
          type: "error",
          error: { type: error.type, message: msg },
        });
        break;
      }
    }

    return events;
  }

  finalizeTurn(outcome: "complete" | "cancelled" | "error" = "complete"): AgentEvent[] {
    const turn = this.currentTurn;
    if (!turn) return [];
    const events: AgentEvent[] = [];
    this.closeOpenParts(turn, events);
    turn.status = outcome;
    turn.usage = { ...this.accumulatedUsage };
    turn.timing = completeTiming(turn.timing);
    events.push({
      type: "turn:end",
      turnId: turn.id,
      status: outcome,
      usage: turn.usage,
      timing: turn.timing,
    });
    this.currentTurn = null;
    return events;
  }

  private closeOpenParts(turn: Turn, events: AgentEvent[]) {
    if (this.currentTextPart) {
      this.currentTextPart.timing = completeTiming(this.currentTextPart.timing);
      events.push({
        type: "part:end",
        turnId: turn.id,
        partId: this.currentTextPart.id,
        timing: this.currentTextPart.timing,
      });
      this.currentTextPart = null;
    }
    if (this.currentThinkingPart) {
      this.currentThinkingPart.timing = completeTiming(this.currentThinkingPart.timing);
      events.push({
        type: "part:end",
        turnId: turn.id,
        partId: this.currentThinkingPart.id,
        timing: this.currentThinkingPart.timing,
      });
      this.currentThinkingPart = null;
    }
  }

  private findActionPart(turn: Turn, partId: string) {
    return turn.parts.find((p) => p.id === partId && p.type === "action");
  }
}
