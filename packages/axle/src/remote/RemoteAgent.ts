import type { AgentErrorResult, AgentResult } from "../core/agent/types.js";
import { Instruct } from "../core/Instruct.js";
import type { OutputSchema, ParsedSchema } from "../core/parse.js";
import { parseResponse } from "../core/parse.js";
import { AxleAgentAbortError } from "../errors/AxleAgentAbortError.js";
import { AxleError } from "../errors/AxleError.js";
import type { AxleProviderFailure } from "../execution/helpers.js";
import type { MessageMetadata, ToolResultPart } from "../messages/message.js";
import type { DeferredCall, ToolCallCallback } from "../tools/types.js";
import type { TurnEvent } from "../turns/events.js";
import { isTurnEvent, Transcript } from "../turns/transcript.js";
import type { Annotation, Turn, TurnFailure } from "../turns/types.js";
import { createStats } from "../utils/stats.js";
import type { LoggedEvent } from "./eventLog.js";
import type { AgentTransport, CommandOutcome } from "./protocol.js";

export type RemoteAgentState =
  | { phase: "connecting" }
  | { phase: "idle" }
  | { phase: "busy"; id: string }
  | { phase: "ended" }
  | { phase: "error"; message: string };

export interface RemoteSendOptions {
  /** Id for the send's user turn, as `SendMessageOptions.id`. Generated when omitted. */
  id?: string;
  metadata?: MessageMetadata;
}

/** The waiting call on a remote agent: `answer` and `fail` each post one command. */
/**
 * What a remote `send` returns: the result, once the events say the turn
 * settled. There is no `cancel`: a queued send cannot be cancelled from
 * here, and `cancel()` on the `RemoteAgent` is the Agent's, for the active
 * turn.
 */
export interface RemoteHandle<T> {
  readonly final: Promise<AgentResult<T> | AgentErrorResult>;
}

export interface RemoteWaitingToolCall {
  answer(content: string | ToolResultPart[]): Promise<CommandOutcome>;
  fail(message: string): Promise<CommandOutcome>;
}

type RemoteResponse = string | ParsedSchema<OutputSchema>;

interface OpenOperation {
  schema: OutputSchema | undefined;
  resolve: (result: AgentResult<RemoteResponse> | AgentErrorResult) => void;
  reject: (error: Error) => void;
}

interface WaitingEntry {
  call: DeferredCall;
  turnId: string;
  partId: string;
  controller: AbortController;
}

function failureOf(failure: TurnFailure): AxleProviderFailure {
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
      return { kind: "parse", message: failure.message, cause: undefined };
  }
}

function isLoggedTurnEvent<THostEvent extends { type: string }>(
  event: LoggedEvent<THostEvent>,
): event is TurnEvent & { cursor: string } {
  return isTurnEvent(event);
}

function textOf(turn: Turn): string {
  return turn.parts.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("");
}

/**
 * An agent served elsewhere, driven through an `AgentTransport`. Events in,
 * commands out, and the same surface a consumer uses on `Agent`: `on`,
 * `onToolCall`, `toolCall(id)`, `send`, `cancel`, `stop`, `clear`. It holds
 * no transcript; it folds each turn only long enough to hand back `turn`
 * and `response` on the send's result, as `Agent` does. `state` is what the
 * events say: `busy` from a queued or open turn to its end, `idle`
 * otherwise, so a connection made in the middle of a turn reads `idle`
 * until that turn's next event arrives.
 */
export class RemoteAgent<THostEvent extends { type: string } = never> {
  private eventCallbacks: Array<(event: LoggedEvent<THostEvent>) => void> = [];
  private stateCallbacks: Array<(state: RemoteAgentState) => void> = [];
  private stateInternal: RemoteAgentState = { phase: "connecting" };
  private fold = new Transcript<Annotation, THostEvent>();
  private operations = new Map<string, OpenOperation>();
  private pendingIds = new Set<string>();
  private openTurn: { turnId: string; operationId: string } | undefined;
  private nextOperationId: string | undefined;
  private waiting = new Map<string, WaitingEntry>();
  private toolCallHandler: ToolCallCallback | undefined;
  private readonly controller = new AbortController();

  constructor(private readonly transport: AgentTransport<THostEvent>) {
    void this.consume();
  }

  get state(): RemoteAgentState {
    return this.stateInternal;
  }

  /** Every entry the served side logged: the agent's turn events and the host's own, each with its cursor. */
  on(callback: (event: LoggedEvent<THostEvent>) => void): () => void {
    this.eventCallbacks.push(callback);
    return () => {
      const index = this.eventCallbacks.indexOf(callback);
      if (index >= 0) this.eventCallbacks.splice(index, 1);
    };
  }

  onState(callback: (state: RemoteAgentState) => void): () => void {
    this.stateCallbacks.push(callback);
    return () => {
      const index = this.stateCallbacks.indexOf(callback);
      if (index >= 0) this.stateCallbacks.splice(index, 1);
    };
  }

  /**
   * Answer the served agent's deferred calls from here, with `onToolCall`'s
   * contract: a returned result is posted as `answer`, a throw as `fail`,
   * nothing leaves the call waiting for whoever else is listening. The
   * handler's signal aborts when the call settles by any route.
   */
  onToolCall(handler: ToolCallCallback): () => void {
    this.toolCallHandler = handler;
    return () => {
      if (this.toolCallHandler === handler) this.toolCallHandler = undefined;
    };
  }

  /** The deferred call this consumer has seen waiting and not yet seen settle. */
  toolCall(id: string): RemoteWaitingToolCall | undefined {
    if (!this.waiting.has(id)) return undefined;
    return {
      answer: (content) => this.transport.command({ type: "answer", callId: id, content }),
      fail: (message) => this.transport.command({ type: "fail", callId: id, message }),
    };
  }

  send(message: string | Instruct<undefined>, options?: RemoteSendOptions): RemoteHandle<string>;
  send<TSchema extends OutputSchema>(
    instruct: Instruct<TSchema>,
    options?: RemoteSendOptions,
  ): RemoteHandle<ParsedSchema<TSchema>>;
  send(
    messageOrInstruct: string | Instruct<OutputSchema | undefined>,
    options: RemoteSendOptions = {},
  ): RemoteHandle<RemoteResponse> {
    const id = options.id ?? crypto.randomUUID();
    const instruct =
      typeof messageOrInstruct === "string"
        ? new Instruct({ prompt: messageOrInstruct, vars: "optional" })
        : messageOrInstruct.clone();
    if (options.metadata) instruct.metadata = options.metadata;
    const {
      promise: final,
      resolve,
      reject,
    } = Promise.withResolvers<AgentResult<RemoteResponse> | AgentErrorResult>();
    final.catch(() => {});
    this.operations.set(id, { schema: instruct.schema, resolve, reject });
    this.transport.command({ type: "send", id, instruct: instruct.toJSON() }).then(
      (outcome) => {
        if (outcome.accepted) return;
        this.settleOperation(id, (op) => op.reject(new AxleError(outcome.reason.message)));
      },
      (error: unknown) => {
        const wrapped = error instanceof Error ? error : new Error(String(error));
        this.settleOperation(id, (op) => op.reject(wrapped));
      },
    );
    return { final };
  }

  async cancel(): Promise<boolean> {
    return (await this.transport.command({ type: "cancel" })).accepted;
  }

  async stop(): Promise<boolean> {
    return (await this.transport.command({ type: "stop" })).accepted;
  }

  async clear(): Promise<boolean> {
    return (await this.transport.command({ type: "clear" })).accepted;
  }

  /** Stop listening. Open sends reject; the served agent is untouched. */
  close(): void {
    this.controller.abort();
    this.rejectAll(new AxleAgentAbortError("RemoteAgent closed"));
    this.setState({ phase: "ended" });
  }

  private async consume(): Promise<void> {
    try {
      const events = await this.transport.events(this.controller.signal);
      this.setState({ phase: "idle" });
      for await (const event of events) this.apply(event);
      if (!this.controller.signal.aborted) {
        this.rejectAll(new AxleAgentAbortError("The served agent ended"));
        this.setState({ phase: "ended" });
      }
    } catch (error) {
      if (this.controller.signal.aborted) return;
      const wrapped = error instanceof Error ? error : new Error(String(error));
      this.rejectAll(wrapped);
      this.setState({ phase: "error", message: wrapped.message });
    }
  }

  private apply(event: LoggedEvent<THostEvent>): void {
    if (isLoggedTurnEvent(event)) this.applyTurnEvent(event);
    for (const callback of [...this.eventCallbacks]) callback(event);
  }

  private applyTurnEvent(event: TurnEvent & { cursor: string }): void {
    this.fold.apply(event);
    switch (event.type) {
      case "pending:queued":
        this.pendingIds.add(event.turn.id);
        this.setState({ phase: "busy", id: event.turn.id });
        break;
      case "pending:dropped":
        this.pendingIds.delete(event.id);
        this.settleOperation(event.id, (op) =>
          op.reject(
            event.reason.type === "cancelled"
              ? new AxleAgentAbortError()
              : new AxleError(event.reason.error.message),
          ),
        );
        this.settleIdle();
        break;
      case "turn:user":
        this.pendingIds.delete(event.turn.id);
        this.nextOperationId = event.turn.id;
        this.setState({ phase: "busy", id: event.turn.id });
        break;
      case "turn:start":
        if (this.nextOperationId !== undefined) {
          this.openTurn = { turnId: event.turnId, operationId: this.nextOperationId };
          this.nextOperationId = undefined;
        }
        break;
      case "action:waiting":
        this.startWaiting(event);
        break;
      case "action:complete":
      case "action:error":
      case "action:cancelled":
        this.forgetWaitingPart(event.partId);
        break;
      case "turn:end":
        this.endTurn(event.turnId);
        break;
    }
  }

  private startWaiting(event: Extract<TurnEvent, { type: "action:waiting" }>): void {
    const call: DeferredCall = { id: event.callId, name: event.name, input: event.input };
    const controller = new AbortController();
    this.waiting.set(call.id, { call, turnId: event.turnId, partId: event.partId, controller });
    const handler = this.toolCallHandler;
    if (!handler) return;
    void Promise.resolve()
      .then(() => handler(call, { signal: controller.signal, emit: () => {} }))
      .then(
        (content) => {
          if (content === undefined || !this.waiting.has(call.id)) return;
          return this.transport.command({ type: "answer", callId: call.id, content });
        },
        (error: unknown) => {
          if (!this.waiting.has(call.id)) return;
          const message = error instanceof Error ? error.message : String(error);
          return this.transport.command({ type: "fail", callId: call.id, message });
        },
      )
      .catch(() => {});
  }

  private forgetWaitingPart(partId: string): void {
    for (const [id, entry] of this.waiting) {
      if (entry.partId !== partId) continue;
      this.waiting.delete(id);
      entry.controller.abort();
    }
  }

  private endTurn(turnId: string): void {
    for (const [id, entry] of [...this.waiting]) {
      if (entry.turnId !== turnId) continue;
      this.waiting.delete(id);
      entry.controller.abort();
    }
    const open = this.openTurn;
    if (open?.turnId === turnId) {
      this.openTurn = undefined;
      const turn = this.fold.getTurn(turnId);
      if (turn) this.settleOperation(open.operationId, (op) => this.resolveFrom(op, turn));
    }
    this.settleIdle();
  }

  private resolveFrom(op: OpenOperation, turn: Turn): void {
    const usage = turn.usage ?? createStats();
    if (turn.status === "cancelled") {
      op.reject(new AxleAgentAbortError("Agent send aborted", { turn, usage }));
      return;
    }
    if (turn.status === "error") {
      op.resolve({
        ok: false,
        error: turn.failure
          ? failureOf(turn.failure)
          : { kind: "incomplete", type: "unknown", message: "The turn ended in error" },
        turn,
        usage,
      });
      return;
    }
    try {
      op.resolve({ ok: true, response: parseResponse(textOf(turn), op.schema), turn, usage });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      op.resolve({ ok: false, error: { kind: "parse", message, cause: error }, turn, usage });
    }
  }

  private settleIdle(): void {
    if (this.openTurn === undefined && this.pendingIds.size === 0) {
      this.fold = new Transcript<Annotation, THostEvent>();
      this.setState({ phase: "idle" });
    }
  }

  private settleOperation(id: string, settle: (op: OpenOperation) => void): void {
    const op = this.operations.get(id);
    if (!op) return;
    this.operations.delete(id);
    settle(op);
  }

  private rejectAll(error: Error): void {
    for (const id of [...this.operations.keys()]) {
      this.settleOperation(id, (op) => op.reject(error));
    }
    for (const entry of this.waiting.values()) entry.controller.abort();
    this.waiting.clear();
  }

  private setState(state: RemoteAgentState): void {
    if (this.stateInternal.phase === "ended" || this.stateInternal.phase === "error") return;
    this.stateInternal = state;
    for (const callback of [...this.stateCallbacks]) callback(state);
  }
}
