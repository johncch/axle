import type { InstructJSON } from "../core/Instruct.js";
import type { ToolResultPart } from "../messages/message.js";
import type { AgentStateEvent } from "../turns/events.js";
import type { StoredEvent } from "./eventStore.js";

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
 * One item on a served agent's stream: an event, logged with its cursor, or
 * the agent's state, which has no cursor and is never replayed.
 */
export type StreamItem<THostEvent extends { type: string } = never> =
  StoredEvent<THostEvent> | AgentStateEvent;

/** `type: "state"` is the agent's; a host event never uses it. */
export function isStateEvent<THostEvent extends { type: string }>(
  item: StreamItem<THostEvent>,
): item is AgentStateEvent {
  return item.type === "state";
}

/**
 * An open stream: the agent's state as it opened, then events and state
 * changes in the order they happened.
 */
export interface AgentSubscription<THostEvent extends { type: string } = never> {
  state: AgentStateEvent;
  items: AsyncIterable<StreamItem<THostEvent>>;
}

/**
 * How events and commands move between a consumer and a served agent. The
 * sequenced events come from the served side's store, agent and host events
 * alike, each with its cursor; a transport that reconnects resumes from the
 * last cursor it delivered, and the state it reopens with arrives as a state
 * event.
 * `events` resolves once the stream is open, which is what a `RemoteAgent`
 * means by connected, or with `undefined` when there is no agent to
 * subscribe to; the items then run until `signal` aborts or the served
 * agent is gone.
 */
export interface AgentTransport<THostEvent extends { type: string } = never> {
  events(signal: AbortSignal): Promise<AgentSubscription<THostEvent> | undefined>;
  command(command: AgentCommand, signal?: AbortSignal): Promise<CommandOutcome>;
}
