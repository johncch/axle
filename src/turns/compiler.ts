import type {
  AxleAssistantMessage,
  AxleMessage,
  AxleToolCallMessage,
  AxleToolCallResult,
  AxleUserMessage,
  ContentPart,
} from "../messages/message.js";
import { AxleStopReason } from "../providers/types.js";
import type { ActionPart, Turn } from "./types.js";

export function compileTurns(turns: Turn[]): AxleMessage[] {
  const messages: AxleMessage[] = [];

  for (const turn of turns) {
    if (turn.owner === "user") {
      messages.push(compileUserTurn(turn));
    } else {
      messages.push(...compileAgentTurn(turn));
    }
  }

  return messages;
}

function compileUserTurn(turn: Turn): AxleUserMessage {
  const content: ContentPart[] = [];

  for (const part of turn.parts) {
    switch (part.type) {
      case "text":
        content.push({ type: "text", text: part.text });
        break;
      case "file":
        content.push({ type: "file", file: part.file });
        break;
    }
  }

  return {
    role: "user",
    id: turn.id,
    content: content.length > 0 ? content : [{ type: "text", text: "" }],
  };
}

function compileAgentTurn(turn: Turn): AxleMessage[] {
  const messages: AxleMessage[] = [];
  const steps = turn.steps;

  let currentAssistantParts: AxleAssistantMessage["content"] = [];
  let pendingToolResults: AxleToolCallResult[] = [];
  let stepIndex = 0;

  const flushAssistant = () => {
    if (currentAssistantParts.length === 0) return;
    const stepMeta = steps?.[stepIndex];
    const msg: AxleAssistantMessage = {
      role: "assistant",
      id: stepMeta?.assistantMessageId ?? `${turn.id}-step-${stepIndex}`,
      content: currentAssistantParts,
      finishReason:
        pendingToolResults.length > 0 ? AxleStopReason.FunctionCall : AxleStopReason.Stop,
    };
    messages.push(msg);
    currentAssistantParts = [];
  };

  const flushToolResults = () => {
    if (pendingToolResults.length === 0) return;
    const stepMeta = steps?.[stepIndex];
    const msg: AxleToolCallMessage = {
      role: "tool",
      id: stepMeta?.toolResultsMessageId ?? `${turn.id}-tools-${stepIndex}`,
      content: pendingToolResults,
    };
    messages.push(msg);
    pendingToolResults = [];
    stepIndex++;
  };

  for (const part of turn.parts) {
    switch (part.type) {
      case "text":
        currentAssistantParts.push({ type: "text", text: part.text });
        break;

      case "thinking":
        currentAssistantParts.push({
          type: "thinking",
          text: part.text,
          summary: part.summary,
          redacted: part.redacted,
        });
        break;

      case "action":
        compileAction(part, currentAssistantParts, pendingToolResults);
        break;
    }
  }

  if (pendingToolResults.length > 0) {
    flushAssistant();
    flushToolResults();
  } else {
    flushAssistant();
  }

  return messages;
}

function compileAction(
  part: ActionPart,
  assistantParts: AxleAssistantMessage["content"],
  toolResults: AxleToolCallResult[],
): void {
  switch (part.kind) {
    case "tool": {
      assistantParts.push({
        type: "tool-call",
        id: part.detail.providerId,
        name: part.detail.name,
        parameters: part.detail.parameters,
      });
      if (part.detail.result) {
        const result = part.detail.result;
        if (result.type === "success") {
          toolResults.push({
            id: part.detail.providerId,
            name: part.detail.name,
            content:
              typeof result.content === "string" ? result.content : JSON.stringify(result.content),
          });
        } else {
          toolResults.push({
            id: part.detail.providerId,
            name: part.detail.name,
            content: JSON.stringify({ error: result.error }),
            isError: true,
          });
        }
      }
      break;
    }

    case "internal-tool": {
      assistantParts.push({
        type: "internal-tool",
        id: part.detail.providerId,
        name: part.detail.name,
        input: part.detail.input,
        output: part.detail.result?.type === "success" ? part.detail.result.content : undefined,
      });
      break;
    }

    case "agent":
      break;
  }
}
