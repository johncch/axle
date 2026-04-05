import type { AxleMessage } from "../messages/message.js";
import type { Turn } from "../turns/types.js";

export class History {
  private _turns: Turn[] = [];
  private _log: AxleMessage[] = [];

  constructor(init?: { turns?: Turn[]; log?: AxleMessage[] }) {
    if (init?.turns) this._turns = init.turns;
    if (init?.log) this._log = init.log;
  }

  get turns(): Turn[] {
    return [...this._turns];
  }

  get log(): AxleMessage[] {
    return [...this._log];
  }

  addTurn(turn: Turn): void {
    this._turns.push(turn);
  }

  appendToLog(messages: AxleMessage | AxleMessage[]): void {
    if (Array.isArray(messages)) {
      this._log.push(...messages);
    } else {
      this._log.push(messages);
    }
  }

  latestTurn(): Turn | undefined {
    return this._turns[this._turns.length - 1];
  }

  toString(): string {
    return JSON.stringify({
      turns: this._turns,
    });
  }
}
