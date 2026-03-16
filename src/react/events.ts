import type { AgentEvent } from "../turns/events.js";
import type {
  Turn,
  TurnPart,
  TextPart,
  ThinkingPart,
  ActionPart,
  ToolAction,
  InternalToolAction,
} from "../turns/types.js";
import type { AgentStatus } from "./types.js";

export interface SSEEvent {
  id?: string;
  event: string;
  data: string;
}

interface EventHandlerContext {
  setTurns: React.Dispatch<React.SetStateAction<Turn[]>>;
  setStatus: React.Dispatch<React.SetStateAction<AgentStatus>>;
  hadErrorRef: React.RefObject<boolean>;
}

function updateTurn(
  turns: Turn[],
  turnId: string,
  updater: (turn: Turn) => Turn,
): Turn[] {
  const next = [...turns];
  for (let i = next.length - 1; i >= 0; i--) {
    if (next[i].id === turnId) {
      next[i] = updater(next[i]);
      return next;
    }
  }
  return next;
}

function updatePart(
  turn: Turn,
  partId: string,
  updater: (part: TurnPart) => TurnPart,
): Turn {
  return {
    ...turn,
    parts: turn.parts.map((p) => (p.id === partId ? updater(p) : p)),
  };
}

export function parseSSEEvents(
  chunk: string,
  buffer: string,
): { events: SSEEvent[]; remaining: string } {
  const text = buffer + chunk;
  const events: SSEEvent[] = [];
  const blocks = text.split("\n\n");
  const remaining = blocks.pop() ?? "";

  for (const block of blocks) {
    if (!block.trim()) continue;
    let id: string | undefined;
    let event = "";
    const dataLines: string[] = [];
    for (const line of block.split("\n")) {
      if (line.startsWith("id: ")) {
        id = line.slice(4);
      } else if (line.startsWith("event: ")) {
        event = line.slice(7);
      } else if (line.startsWith("data: ")) {
        dataLines.push(line.slice(6));
      }
    }
    if (event && dataLines.length > 0) {
      events.push({ id, event, data: dataLines.join("\n") });
    }
  }

  return { events, remaining };
}

export function handleSSEEvent(event: SSEEvent, ctx: EventHandlerContext): void {
  const parsed: AgentEvent = JSON.parse(event.data);
  const { setTurns, setStatus, hadErrorRef } = ctx;

  switch (parsed.type) {
    case "session:restore": {
      setTurns(parsed.turns);
      setStatus("ready");
      break;
    }

    case "turn:user": {
      setTurns((prev) => [...prev, parsed.turn]);
      break;
    }

    case "turn:start": {
      setStatus("streaming");
      const newTurn: Turn = { id: parsed.turnId, owner: "agent", parts: [] };
      setTurns((prev) => [...prev, newTurn]);
      break;
    }

    case "part:start": {
      setTurns((prev) =>
        updateTurn(prev, parsed.turnId, (turn) => ({
          ...turn,
          parts: [...turn.parts, parsed.part],
        })),
      );
      break;
    }

    case "text:delta": {
      setTurns((prev) =>
        updateTurn(prev, parsed.turnId, (turn) =>
          updatePart(turn, parsed.partId, (part) => {
            const p = part as TextPart;
            return { ...p, text: p.text + parsed.delta };
          }),
        ),
      );
      break;
    }

    case "thinking:delta": {
      setTurns((prev) =>
        updateTurn(prev, parsed.turnId, (turn) =>
          updatePart(turn, parsed.partId, (part) => {
            const p = part as ThinkingPart;
            return { ...p, text: p.text + parsed.delta };
          }),
        ),
      );
      break;
    }

    case "part:end": {
      // No state change needed — part is already accumulated
      break;
    }

    case "action:running": {
      setTurns((prev) =>
        updateTurn(prev, parsed.turnId, (turn) =>
          updatePart(turn, parsed.partId, (part) => {
            const p = part as ActionPart;
            if (parsed.parameters && p.kind === "tool") {
              return { ...p, status: "running", detail: { ...p.detail, parameters: parsed.parameters } } as ActionPart;
            }
            return { ...p, status: "running" } as ActionPart;
          }),
        ),
      );
      break;
    }

    case "action:complete": {
      setTurns((prev) =>
        updateTurn(prev, parsed.turnId, (turn) =>
          updatePart(turn, parsed.partId, (part) => {
            const p = part as ActionPart;
            return { ...p, status: "complete", detail: { ...p.detail, result: parsed.result } } as ActionPart;
          }),
        ),
      );
      break;
    }

    case "action:error": {
      setTurns((prev) =>
        updateTurn(prev, parsed.turnId, (turn) =>
          updatePart(turn, parsed.partId, (part) => {
            const p = part as ActionPart;
            return {
              ...p,
              status: "error",
              detail: { ...p.detail, result: { type: "error" as const, error: parsed.error } },
            } as ActionPart;
          }),
        ),
      );
      break;
    }

    case "turn:end": {
      setTurns((prev) =>
        updateTurn(prev, parsed.turnId, (turn) => ({
          ...turn,
          usage: parsed.usage,
        })),
      );
      setStatus("ready");
      break;
    }

    case "error": {
      hadErrorRef.current = true;
      setStatus("error");
      break;
    }

    case "action:child-event": {
      // Not handled in flat rendering — could be extended
      break;
    }
  }
}
