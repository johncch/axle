import { AxleError } from "../errors/AxleError.js";
import type { AxleMessage } from "./message.js";

/**
 * Record of one applied compaction: when it happened. Inspection only —
 * records carry no message content and cannot reconstruct the pre-compaction
 * conversation.
 *
 * @experimental Compaction is under active design and may change in any release.
 */
export interface CompactionRecord {
  /** Stable record id. Shared with the compaction turn. */
  id: string;
  /** ISO timestamp for when the compaction ran. */
  at: string;
}

/**
 * Validate that a compacted conversation is structurally well-formed.
 *
 * The messages must stand alone: every tool call must be answered by the
 * tool message(s) immediately following it — providers reject conversations
 * that interleave other messages between a call and its result — and every
 * tool result must answer a preceding call.
 *
 * @experimental Compaction is under active design and may change in any release.
 * @throws AxleError with code `COMPACTION_INVALID_MESSAGES`
 */
export function validateCompactedMessages(messages: AxleMessage[]): void {
  const fail = (message: string, details?: Record<string, any>): never => {
    throw new AxleError(message, { code: "COMPACTION_INVALID_MESSAGES", details });
  };

  const pendingToolCalls = new Set<string>();

  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    if (pendingToolCalls.size > 0 && message.role !== "tool") {
      fail(
        `Compacted messages interleave a "${message.role}" message before tool calls are answered: ${[...pendingToolCalls].join(", ")}`,
        { messageIndex: i, toolCallIds: [...pendingToolCalls] },
      );
    }
    switch (message.role) {
      case "user":
        break;
      case "assistant":
        for (const part of message.content) {
          if (part.type !== "tool-call") continue;
          if (pendingToolCalls.has(part.id)) {
            fail(`Compacted messages repeat unanswered tool call id "${part.id}"`, {
              messageIndex: i,
              toolCallId: part.id,
            });
          }
          pendingToolCalls.add(part.id);
        }
        break;
      case "tool":
        for (const result of message.content) {
          if (!pendingToolCalls.has(result.id)) {
            fail(
              `Compacted messages have a tool result for id "${result.id}" with no preceding tool call`,
              { messageIndex: i, toolCallId: result.id },
            );
          }
          pendingToolCalls.delete(result.id);
        }
        break;
      default:
        fail(`Compacted messages include a message with unknown role "${(message as any).role}"`, {
          messageIndex: i,
        });
    }
  }

  if (pendingToolCalls.size > 0) {
    fail(`Compacted messages end with unanswered tool calls: ${[...pendingToolCalls].join(", ")}`, {
      toolCallIds: [...pendingToolCalls],
    });
  }
}
