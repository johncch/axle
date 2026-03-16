import type { AxleMessage } from "./message.js";
import type { Turn } from "../turns/types.js";
import { compileTurns } from "../turns/compiler.js";

export class History {
  system: string;
  private _turns: Turn[] = [];

  constructor(turns?: Turn[]) {
    if (turns) {
      this._turns = turns;
    }
  }

  get turns(): Turn[] {
    return [...this._turns];
  }

  addTurn(turn: Turn): void {
    this._turns.push(turn);
  }

  updateTurn(turnId: string, updater: (turn: Turn) => Turn): void {
    const index = this._turns.findIndex((t) => t.id === turnId);
    if (index >= 0) {
      this._turns[index] = updater(this._turns[index]);
    }
  }

  latestTurn(): Turn | undefined {
    return this._turns[this._turns.length - 1];
  }

  toMessages(): AxleMessage[] {
    return compileTurns(this._turns);
  }

  toString(): string {
    return JSON.stringify({
      system: this.system,
      turns: this._turns,
    });
  }
}
