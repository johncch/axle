import type { CompactionRecord } from "../../messages/compaction.js";
import type { AxleMessage } from "../../messages/message.js";
import type { Annotation, Turn } from "../../turns/types.js";

/**
 * Complete state for constructing a `History`. Reconstructing from a saved
 * session goes through the constructor — there is no field-by-field mutation.
 */
export interface HistoryInit<TAnnotation extends Annotation = Annotation> {
  turns?: Turn<TAnnotation>[];
  messages?: AxleMessage[];
  archive?: AxleMessage[];
  compactions?: CompactionRecord[];
  sessionAnnotations?: TAnnotation[];
}

/**
 * In-memory conversation and presentation state for an agent.
 *
 * All state is private; reads return copies and writes go through
 * use-case-specific methods:
 *
 * - `messages` — the active, model-facing conversation. Requests are built
 *   from it; compaction replaces it.
 * - `archive` — every message ever appended, in order, untouched by
 *   compaction. The chronological record, for inspection only.
 * - `turns` — the renderable session turns: user/agent entries and compaction entries.
 *   Forever-accumulating; consumers decide how to render or prune it.
 * - `compactions` — receipts for each applied compaction.
 * - `sessionAnnotations` — session-level render annotations.
 *
 * @typeParam TAnnotation - Annotation union supported by the host renderer.
 */
export class History<TAnnotation extends Annotation = Annotation> {
  private _turns: Turn<TAnnotation>[];
  private _messages: AxleMessage[];
  private _archive: AxleMessage[];
  private _compactions: CompactionRecord[];
  private _sessionAnnotations: TAnnotation[];

  constructor(init?: HistoryInit<TAnnotation>) {
    this._turns = [...(init?.turns ?? [])];
    this._messages = [...(init?.messages ?? [])];
    // Sessions saved before the archive existed seed it from the restored
    // messages, so a later compaction cannot drop them from the record.
    this._archive = [...(init?.archive ?? init?.messages ?? [])];
    this._compactions = [...(init?.compactions ?? [])];
    this._sessionAnnotations = [...(init?.sessionAnnotations ?? [])];
  }

  get turns(): Turn<TAnnotation>[] {
    return [...this._turns];
  }

  get messages(): AxleMessage[] {
    return [...this._messages];
  }

  get archive(): AxleMessage[] {
    return [...this._archive];
  }

  get compactions(): CompactionRecord[] {
    return [...this._compactions];
  }

  get sessionAnnotations(): TAnnotation[] {
    return [...this._sessionAnnotations];
  }

  /**
   * Append conversation messages. Every appended message goes to both the
   * active conversation and the archive, so the archive is always the
   * complete chronological record regardless of compaction.
   *
   * @internal The Agent is History's only writer. Direct writes bypass the
   * work queue and the event fold, desynchronizing engine state.
   */
  append(messages: AxleMessage | AxleMessage[]): void {
    const list = Array.isArray(messages) ? messages : [messages];
    this._messages.push(...list);
    this._archive.push(...list);
  }

  /**
   * Replace the renderable turn state wholesale. Used to sync the
   * accumulated state after applying a turn event.
   *
   * @internal The Agent is History's only writer. External writes are
   * overwritten by the agent's accumulator on the next event.
   */
  replaceTurns(turns: Turn<TAnnotation>[], sessionAnnotations: TAnnotation[]): void {
    // The accumulator replaces its arrays wholesale and never mutates them,
    // so the references are stored as-is; this runs per streamed event and a
    // defensive copy here would be O(session turns) per delta. Getters copy.
    this._turns = turns;
    this._sessionAnnotations = sessionAnnotations;
  }

  /**
   * Apply a compaction: the new state replaces the active conversation and
   * the record is kept. The archive is untouched — it already holds
   * everything ever appended. The corresponding compaction turn arrives
   * through the event fold, not here.
   *
   * @internal The Agent is History's only writer; use `agent.compact()`.
   * @experimental Compaction is under active design and may change in any release.
   */
  compact(messages: AxleMessage[], record: CompactionRecord): void {
    this._messages = [...messages];
    this._compactions.push(record);
  }
}
