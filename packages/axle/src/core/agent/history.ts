import type { AxleMessage } from "../../messages/message.js";
import type { Annotation, Turn } from "../../turns/types.js";

/**
 * In-memory conversation and presentation history for an agent.
 *
 * `log` is the canonical model-facing message history. `turns` and
 * `sessionAnnotations` are renderable presentation state for consumers.
 *
 * @typeParam TAnnotation - Annotation union supported by the host renderer.
 */
export class History<TAnnotation extends Annotation = Annotation> {
  private _turns: Turn<TAnnotation>[] = [];
  private _log: AxleMessage[] = [];
  private _sessionAnnotations: TAnnotation[] = [];

  constructor(init?: {
    turns?: Turn<TAnnotation>[];
    log?: AxleMessage[];
    sessionAnnotations?: TAnnotation[];
  }) {
    if (init?.turns) this._turns = [...init.turns];
    if (init?.log) this._log = [...init.log];
    if (init?.sessionAnnotations) this._sessionAnnotations = [...init.sessionAnnotations];
  }

  get turns(): Turn<TAnnotation>[] {
    return [...this._turns];
  }

  get log(): AxleMessage[] {
    return [...this._log];
  }

  get sessionAnnotations(): TAnnotation[] {
    return [...this._sessionAnnotations];
  }

  addTurn(turn: Turn<TAnnotation>): void {
    this._turns.push(turn);
  }

  replaceTurns(turns: Turn<TAnnotation>[]): void {
    this._turns = [...turns];
  }

  replaceLog(messages: AxleMessage[]): void {
    this._log = [...messages];
  }

  replaceSessionAnnotations(annotations: TAnnotation[] = []): void {
    this._sessionAnnotations = [...annotations];
  }

  appendToLog(messages: AxleMessage | AxleMessage[]): void {
    if (Array.isArray(messages)) {
      this._log.push(...messages);
    } else {
      this._log.push(messages);
    }
  }

  latestTurn(): Turn<TAnnotation> | undefined {
    return this._turns[this._turns.length - 1];
  }

  toString(): string {
    return JSON.stringify({
      turns: this._turns,
      sessionAnnotations: this._sessionAnnotations,
    });
  }
}
