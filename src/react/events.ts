import type {
  AxleAssistantMessage,
  AxleToolCallMessage,
  AxleUserMessage,
  ContentPartThinking,
} from "../messages/message.js";
import type { ToolCallResult } from "../providers/helpers.js";
import { AxleStopReason } from "../providers/types.js";
import type {
  AgentStatus,
  ClientAssistantMessage,
  ClientContentPartToolCall,
  ClientMessage,
} from "./types.js";

export interface SSEEvent {
  id?: string;
  event: string;
  data: string;
}

interface EventHandlerContext {
  setMessages: React.Dispatch<React.SetStateAction<ClientMessage[]>>;
  setStatus: React.Dispatch<React.SetStateAction<AgentStatus>>;
  hadErrorRef: React.RefObject<boolean>;
}

function updateLastAssistant(
  messages: ClientMessage[],
  updater: (msg: ClientAssistantMessage) => ClientAssistantMessage,
): ClientMessage[] {
  const next = [...messages];
  for (let i = next.length - 1; i >= 0; i--) {
    if (next[i].role === "assistant") {
      next[i] = updater(next[i] as ClientAssistantMessage);
      return next;
    }
  }
  return next;
}

function mapToClientAssistant(msg: AxleAssistantMessage): ClientAssistantMessage {
  return {
    role: "assistant",
    id: msg.id,
    model: msg.model,
    content: msg.content.map((part) => {
      if (part.type === "tool-call") {
        return {
          type: "tool-call" as const,
          id: part.id,
          name: part.name,
          parameters: part.parameters,
          status: "complete" as const,
        };
      }
      return part;
    }),
    finishReason: msg.finishReason,
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
  const parsed = JSON.parse(event.data);
  const { setMessages, setStatus, hadErrorRef } = ctx;

  switch (event.event) {
    case "message:user": {
      const e = parsed as { type: "message:user"; message: AxleUserMessage };
      setMessages((prev) => [...prev, e.message]);
      break;
    }
    case "turn:start": {
      const e = parsed as { type: "turn:start"; id: string; model: string };
      setStatus("streaming");
      setMessages((prev) => [
        ...prev,
        { role: "assistant", id: e.id, model: e.model, content: [] },
      ]);
      break;
    }
    case "text:delta": {
      const e = parsed as { type: "text:delta"; accumulated: string };
      setMessages((prev) =>
        updateLastAssistant(prev, (msg) => {
          const content = [...msg.content];
          const lastPart = content[content.length - 1];
          if (lastPart && lastPart.type === "text") {
            content[content.length - 1] = { ...lastPart, text: e.accumulated };
          } else {
            content.push({ type: "text", text: e.accumulated });
          }
          return { ...msg, content };
        }),
      );
      break;
    }
    case "thinking:delta": {
      const e = parsed as { type: "thinking:delta"; accumulated: string };
      setMessages((prev) =>
        updateLastAssistant(prev, (msg) => {
          const content = [...msg.content];
          const lastPart = content[content.length - 1];
          if (lastPart && lastPart.type === "thinking") {
            content[content.length - 1] = {
              ...(lastPart as ContentPartThinking),
              text: e.accumulated,
            };
          } else {
            content.push({ type: "thinking", text: e.accumulated });
          }
          return { ...msg, content };
        }),
      );
      break;
    }
    case "tool:request": {
      const e = parsed as { type: "tool:request"; id: string; name: string };
      const toolCall: ClientContentPartToolCall = {
        type: "tool-call",
        id: e.id,
        name: e.name,
        parameters: {},
        status: "pending",
      };
      setMessages((prev) =>
        updateLastAssistant(prev, (msg) => ({
          ...msg,
          content: [...msg.content, toolCall],
        })),
      );
      break;
    }
    case "tool:exec-start": {
      const e = parsed as {
        type: "tool:exec-start";
        id: string;
        parameters: Record<string, unknown>;
      };
      setMessages((prev) =>
        updateLastAssistant(prev, (msg) => ({
          ...msg,
          content: msg.content.map((part) =>
            part.type === "tool-call" && part.id === e.id
              ? { ...part, status: "running" as const, parameters: e.parameters }
              : part,
          ),
        })),
      );
      break;
    }
    case "tool:exec-complete": {
      const e = parsed as {
        type: "tool:exec-complete";
        id: string;
        result: ToolCallResult | null;
      };
      setMessages((prev) =>
        updateLastAssistant(prev, (msg) => ({
          ...msg,
          content: msg.content.map((part) => {
            if (part.type !== "tool-call" || part.id !== e.id) return part;
            const isError = e.result?.type === "error";
            return {
              ...part,
              status: isError ? ("error" as const) : ("complete" as const),
              result: e.result,
            };
          }),
        })),
      );
      break;
    }
    case "internal-tool:start": {
      const e = parsed as { type: "internal-tool:start"; id: string; name: string };
      setMessages((prev) =>
        updateLastAssistant(prev, (msg) => ({
          ...msg,
          content: [...msg.content, { type: "internal-tool" as const, id: e.id, name: e.name }],
        })),
      );
      break;
    }
    case "internal-tool:complete": {
      const e = parsed as {
        type: "internal-tool:complete";
        id: string;
        name: string;
        output?: unknown;
      };
      setMessages((prev) =>
        updateLastAssistant(prev, (msg) => ({
          ...msg,
          content: msg.content.map((part) =>
            part.type === "internal-tool" && part.id === e.id
              ? { ...part, output: e.output }
              : part,
          ),
        })),
      );
      break;
    }
    case "turn:complete": {
      const e = parsed as { type: "turn:complete"; message: AxleAssistantMessage };
      const clientMsg = mapToClientAssistant(e.message);
      setMessages((prev) => {
        const next = [...prev];
        for (let i = next.length - 1; i >= 0; i--) {
          if (next[i].role === "assistant") {
            next[i] = clientMsg;
            break;
          }
        }
        return next;
      });
      if (e.message.finishReason !== AxleStopReason.FunctionCall) {
        setStatus("ready");
      }
      break;
    }
    case "tool-results:complete": {
      const e = parsed as { type: "tool-results:complete"; message: AxleToolCallMessage };
      setMessages((prev) => [...prev, e.message]);
      break;
    }
    case "error": {
      hadErrorRef.current = true;
      setStatus("error");
      break;
    }
  }
}
