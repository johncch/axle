import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import {
  parseBackgroundReply,
  queryUserMessageBackground,
  userMessageBackground,
} from "../../src/ui/terminal-background.js";

function fakeTerminal(reply: string | undefined, colorDepth = 24) {
  const pending: Buffer[] = [];
  const stdin = Object.assign(new EventEmitter(), {
    isTTY: true,
    isRaw: false,
    setRawMode(raw: boolean) {
      stdin.isRaw = raw;
    },
    read: () => pending.shift() ?? null,
  });
  const written: string[] = [];
  const stdout = {
    isTTY: true,
    getColorDepth: () => colorDepth,
    write(text: string) {
      written.push(text);
      if (reply !== undefined) {
        pending.push(Buffer.from(reply));
        queueMicrotask(() => stdin.emit("readable"));
      }
      return true;
    },
  };
  return {
    stdin: stdin as unknown as NodeJS.ReadStream,
    stdout: stdout as unknown as NodeJS.WriteStream,
    written,
  };
}

describe("parseBackgroundReply", () => {
  it("reads 16-bit, 8-bit and BEL-terminated replies", () => {
    expect(parseBackgroundReply("\u001b]11;rgb:1e1e/2020/ffff\u001b\\")).toEqual([30, 32, 255]);
    expect(parseBackgroundReply("\u001b]11;rgb:1e/20/ff\u0007")).toEqual([30, 32, 255]);
    expect(parseBackgroundReply("\u001b[?62;22c")).toBeUndefined();
  });
});

describe("userMessageBackground", () => {
  it("lifts a dark background and lowers a light one", () => {
    // 8% white over black: 255 * 0.08 = 20.4
    expect(userMessageBackground([0, 0, 0])).toBe("#141414");
    // 4% black over white: 255 * 0.96 = 244.8
    expect(userMessageBackground([255, 255, 255])).toBe("#f5f5f5");
  });
});

describe("queryUserMessageBackground", () => {
  it("asks for the background and shades the answer", async () => {
    const terminal = fakeTerminal("\u001b]11;rgb:0000/0000/0000\u001b\\\u001b[?62;22c");

    await expect(queryUserMessageBackground(terminal.stdin, terminal.stdout)).resolves.toBe(
      "#141414",
    );
    expect(terminal.written.join("")).toContain("\u001b]11;?");
    expect(terminal.stdin.isRaw).toBe(false);
  });

  it("gives no fill when the terminal answers only the device query", async () => {
    const terminal = fakeTerminal("\u001b[?62;22c");

    await expect(
      queryUserMessageBackground(terminal.stdin, terminal.stdout),
    ).resolves.toBeUndefined();
  });

  it("gives no fill when the terminal does not answer", async () => {
    const terminal = fakeTerminal(undefined);

    await expect(
      queryUserMessageBackground(terminal.stdin, terminal.stdout),
    ).resolves.toBeUndefined();
  });

  it("does not ask a terminal with 16 colours", async () => {
    const terminal = fakeTerminal("\u001b]11;rgb:0000/0000/0000\u001b\\\u001b[?62;22c", 4);

    await expect(
      queryUserMessageBackground(terminal.stdin, terminal.stdout),
    ).resolves.toBeUndefined();
    expect(terminal.written).toEqual([]);
  });
});
