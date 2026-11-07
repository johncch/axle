import * as z from "zod";
import type { AgentStateEvent } from "../turns/events.js";
import type { StoredEvent } from "./eventStore.js";

const fileBase = { mimeType: z.string(), name: z.string(), size: z.number().optional() };
const urlSource = z.object({ type: z.literal("url"), url: z.string() });
const refSource = z.object({ type: z.literal("ref"), ref: z.unknown() });

const fileInfoSchema = z.discriminatedUnion("kind", [
  z.object({
    ...fileBase,
    kind: z.literal("text"),
    source: z.discriminatedUnion("type", [
      z.object({ type: z.literal("text"), content: z.string() }),
      urlSource,
      refSource,
    ]),
  }),
  z.object({
    ...fileBase,
    kind: z.enum(["image", "document"]),
    source: z.discriminatedUnion("type", [
      z.object({ type: z.literal("base64"), data: z.string() }),
      urlSource,
      refSource,
    ]),
  }),
]);

const toolResultPartSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string() }),
  z.object({ type: z.literal("file"), file: fileInfoSchema }),
]);

/**
 * What a consumer asks of a served agent, each one Agent method. `send`
 * carries the rendered prompt, its files and metadata, and names its user
 * turn with `id` so the consumer can match the events it hears back;
 * `answer` and `fail` settle the waiting call `callId`; the rest take
 * nothing. A file's source crosses as it is: a `ref` means whatever the
 * host's `fileResolver` makes of it.
 */
export const agentCommandSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("send"),
    id: z.string().min(1),
    prompt: z.string(),
    files: z.array(fileInfoSchema).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  }),
  z.object({
    type: z.literal("answer"),
    callId: z.string().min(1),
    content: z.union([z.string(), z.array(toolResultPartSchema)]),
  }),
  z.object({ type: z.literal("fail"), callId: z.string().min(1), message: z.string() }),
  z.object({ type: z.literal("cancel") }),
  z.object({ type: z.literal("stop") }),
  z.object({ type: z.literal("clear") }),
]);

export type AgentCommand = z.infer<typeof agentCommandSchema>;

/**
 * Whether the Agent took the command. `not-waiting` is an answer or fail
 * for a call the Agent is not waiting on, `idle` a cancel or stop with no
 * active turn; a send and a clear always take. Everything after acceptance
 * arrives as events.
 */
export const commandOutcomeSchema = z.discriminatedUnion("accepted", [
  z.object({ accepted: z.literal(true) }),
  z.object({
    accepted: z.literal(false),
    reason: z.object({ type: z.enum(["not-waiting", "idle"]), message: z.string() }),
  }),
]);

export type CommandOutcome = z.infer<typeof commandOutcomeSchema>;

/** A request body as an `AgentCommand`, or `null` when it is not one. */
export function parseAgentCommand(body: unknown): AgentCommand | null {
  const parsed = agentCommandSchema.safeParse(body);
  return parsed.success ? parsed.data : null;
}

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
