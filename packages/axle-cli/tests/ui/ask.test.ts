import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { confirm, isCancel, select, text } from "../../src/ui/ask.js";

let input: PassThrough;
let written: string[];
const originalWrite = process.stdout.write;

beforeEach(() => {
  input = new PassThrough();
  written = [];
  process.stdout.write = ((chunk: string | Uint8Array) => {
    written.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
});

afterEach(() => {
  process.stdout.write = originalWrite;
});

function pressKeys(keys: string): void {
  setTimeout(() => input.write(keys), 0);
}

// eslint-disable-next-line no-control-regex
const stripAnsi = (s: string) => s.replace(/\u001b\[[0-9;]*[A-Za-z]/g, "");
const output = () => stripAnsi(written.join(""));

describe("ask", () => {
  it("text echoes the answer on the question line", async () => {
    pressKeys("gpt-5\r");
    const value = await text({ message: "Model id", input, output: process.stdout });
    expect(value).toBe("gpt-5");
    expect(output()).toContain("? Model id gpt-5");
  });

  it("confirm submits on y without Enter", async () => {
    pressKeys("y");
    const value = await confirm({
      message: "Save?",
      initialValue: false,
      input,
      output: process.stdout,
    });
    expect(value).toBe(true);
    expect(output()).toContain("? Save? Yes");
  });

  it("confirm shows the default in the hint", async () => {
    pressKeys("\r");
    await confirm({ message: "Save?", initialValue: false, input, output: process.stdout });
    expect(output()).toContain("(y/N)");
  });

  it("select moves with arrows and echoes the label", async () => {
    pressKeys("\u001b[B\r");
    const value = await select({
      message: "Provider",
      options: [
        { value: "a", label: "Anthropic" },
        { value: "o", label: "OpenAI" },
      ],
      input,
      output: process.stdout,
    });
    expect(value).toBe("o");
    expect(output()).toContain("> OpenAI");
    expect(output()).toContain("? Provider OpenAI");
  });

  it("ctrl-c cancels", async () => {
    pressKeys("\u0003");
    const value = await text({ message: "Model id", input, output: process.stdout });
    expect(isCancel(value)).toBe(true);
  });
});
