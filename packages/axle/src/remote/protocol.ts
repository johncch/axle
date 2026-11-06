import type { InstructJSON } from "../core/Instruct.js";
import type { ToolResultPart } from "../messages/message.js";
import type { TurnEvent } from "../turns/events.js";

/**
 * What a consumer asks of a served agent. Each is one Agent method: `send`
 * carries the Instruct as `toJSON()` gives it and names its user turn with
 * `id` so the consumer can match the events it hears back; `answer` and
 * `fail` settle the waiting call `callId` through `agent.toolCall(id)`; the
 * rest take nothing.
 */
export type AgentCommand =
  | { type: "send"; id: string; instruct: InstructJSON }
  | { type: "answer"; callId: string; content: string | ToolResultPart[] }
  | { type: "fail"; callId: string; message: string }
  | { type: "cancel" }
  | { type: "stop" }
  | { type: "clear" };

/**
 * Whether the Agent took the command. `not-waiting` is an answer or fail
 * for a call the Agent is not waiting on, `idle` a cancel or stop with no
 * active turn; a send and a clear always take. Everything after acceptance
 * arrives as events.
 */
export type CommandOutcome =
  | { accepted: true }
  | { accepted: false; reason: { type: "not-waiting" | "idle"; message: string } };

/**
 * How events and commands move between a consumer and a served agent. The
 * events are the Agent's own, cursor included; a transport that puts them
 * on a wire carries the cursor so the consumer can say where it stopped.
 * `events` resolves once the stream is open, which is what a `RemoteAgent`
 * means by connected; the iterable then runs until `signal` aborts or the
 * served agent is gone.
 */
export interface AgentTransport {
  events(signal: AbortSignal): Promise<AsyncIterable<TurnEvent & { cursor: string }>>;
  command(command: AgentCommand, signal?: AbortSignal): Promise<CommandOutcome>;
}
