import type { Interface } from "node:readline";
import { createInterface } from "node:readline";

/**
 * Readline-backed input prompt. Resolves null when the user ends the chat
 * (Ctrl-C or Ctrl-D at the prompt).
 *
 * The interface lives only for the duration of one question: while it is
 * open the terminal is in raw mode and Ctrl-C arrives as an interface event,
 * so keeping it open across a running turn would swallow the SIGINT the
 * runner's two-stage interrupt listens for. Between prompts the terminal is
 * back in cooked mode and Ctrl-C is a real signal.
 */
export class ReadlinePrompt {
  private active?: Interface;
  private ended = false;

  prompt(): Promise<string | null> {
    // stdin can hit EOF (pipe drained, Ctrl-D mid-turn) while no interface
    // is open; asking a finished stream would hang, so it ends the chat.
    if (this.ended || process.stdin.readableEnded) return Promise.resolve(null);
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    this.active = rl;
    rl.on("SIGINT", () => rl.close());
    return new Promise((resolve) => {
      const onClose = () => {
        this.ended = true;
        this.active = undefined;
        resolve(null);
      };
      rl.once("close", onClose);
      rl.question("\n> ", (answer) => {
        rl.removeListener("close", onClose);
        rl.close();
        this.active = undefined;
        resolve(answer);
      });
    });
  }

  close(): void {
    this.active?.close();
    this.active = undefined;
  }
}
