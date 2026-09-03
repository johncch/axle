import type { Interface } from "node:readline";
import { createInterface } from "node:readline";

/**
 * Readline-backed input prompt. Resolves null when the user ends the chat
 * (Ctrl-C or Ctrl-D at the prompt). While readline is active the terminal is
 * in raw mode, so Ctrl-C arrives here as an interface event — the process
 * SIGINT handler only sees Ctrl-C pressed during a running turn.
 */
export class ReadlinePrompt {
  private rl?: Interface;
  private ended = false;

  prompt(): Promise<string | null> {
    // stdin can hit EOF (pipe drained, Ctrl-D) while no question is pending;
    // asking a closed interface throws, so a finished stream ends the chat.
    if (this.ended) return Promise.resolve(null);
    const rl = (this.rl ??= this.create());
    return new Promise((resolve) => {
      const onClose = () => resolve(null);
      rl.once("close", onClose);
      rl.question("\n> ", (answer) => {
        rl.removeListener("close", onClose);
        resolve(answer);
      });
    });
  }

  close(): void {
    this.rl?.close();
    this.rl = undefined;
  }

  private create(): Interface {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.on("SIGINT", () => rl.close());
    rl.on("close", () => {
      this.ended = true;
    });
    return rl;
  }
}
