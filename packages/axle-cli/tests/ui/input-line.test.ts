import { render } from "ink";
import { PassThrough } from "node:stream";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { App } from "../../src/ui/ink/App.js";
import type { UiState } from "../../src/ui/ink/store.js";
import { UiStore } from "../../src/ui/ink/store.js";

class FakeTty extends PassThrough {
  isTTY = true;
  columns = 80;
  rows = 24;
  setRawMode(): this {
    return this;
  }
  ref(): this {
    return this;
  }
  unref(): this {
    return this;
  }
}

async function submitAfterKeys(keys: string[]): Promise<string | null | undefined> {
  const stdin = new FakeTty();
  const stdout = new FakeTty();
  stdout.resume();
  let submitted: string | null | undefined;
  const store = new UiStore<UiState>({
    staticItems: [],
    awaitingInput: true,
    pending: [],
    queuedInputs: [],
  });
  const instance = render(
    createElement(App, {
      store,
      statusBar: false,
      onSubmit(value: string | null) {
        submitted = value;
      },
    }),
    {
      stdin: stdin as unknown as NodeJS.ReadStream,
      stdout: stdout as unknown as NodeJS.WriteStream,
      exitOnCtrlC: false,
      patchConsole: false,
    },
  );
  for (const key of [...keys, "\r"]) {
    stdin.write(key);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  instance.unmount();
  return submitted;
}

const LEFT = "\x1b[D";
const OPTION_LEFT_AS_ESC_B = "\x1bb";
const OPTION_LEFT_AS_META_ARROW = "\x1b[1;3D";
const OPTION_BACKSPACE = "\x1b\x7f";
const CMD_LEFT_AS_CTRL_A = "\x01";
const CMD_LEFT_AS_HOME = "\x1b[H";
const CMD_LEFT_AS_KITTY_SUPER = "\x1b[1;9D";
const CMD_RIGHT_AS_CTRL_E = "\x05";
const CMD_BACKSPACE_AS_CTRL_U = "\x15";
const CTRL_W = "\x17";
const SHIFT_ENTER_AS_KITTY = "\x1b[13;2u";
const OPTION_ENTER_AS_ESC_CR = "\x1b\r";
const CTRL_J_AS_LINE_FEED = "\n";
const CTRL_J_AS_KITTY = "\x1b[106;5u";

describe("chat input line keys", () => {
  it("inserts at the cursor after moving left", async () => {
    expect(await submitAfterKeys(["ac", LEFT, "b"])).toBe("abc");
  });

  it.each([
    ["Esc-b", OPTION_LEFT_AS_ESC_B],
    ["a meta arrow", OPTION_LEFT_AS_META_ARROW],
  ])("moves back a word when Option-Left arrives as %s", async (_form, key) => {
    expect(await submitAfterKeys(["fix report", key, "the "])).toBe("fix the report");
  });

  it.each([
    ["Ctrl-A", CMD_LEFT_AS_CTRL_A],
    ["Home", CMD_LEFT_AS_HOME],
    ["a kitty super arrow", CMD_LEFT_AS_KITTY_SUPER],
  ])("moves to the line start when Cmd-Left arrives as %s", async (_form, key) => {
    expect(await submitAfterKeys(["world", key, "hello "])).toBe("hello world");
  });

  it("moves to the line end on Ctrl-E", async () => {
    expect(await submitAfterKeys(["hello", CMD_LEFT_AS_CTRL_A, CMD_RIGHT_AS_CTRL_E, "!"])).toBe(
      "hello!",
    );
  });

  it.each([
    ["Esc-DEL", OPTION_BACKSPACE],
    ["Ctrl-W", CTRL_W],
  ])("deletes the previous word when Option-Backspace arrives as %s", async (_form, key) => {
    expect(await submitAfterKeys(["run the tests agian", key, "again"])).toBe(
      "run the tests again",
    );
  });

  it("deletes to the line start on Ctrl-U", async () => {
    expect(await submitAfterKeys(["wrong", CMD_BACKSPACE_AS_CTRL_U, "right"])).toBe("right");
  });

  it.each([
    ["Shift-Enter under the kitty protocol", SHIFT_ENTER_AS_KITTY],
    ["Option-Enter as Esc-CR", OPTION_ENTER_AS_ESC_CR],
    ["Ctrl-J as a line feed", CTRL_J_AS_LINE_FEED],
    ["Ctrl-J under the kitty protocol", CTRL_J_AS_KITTY],
  ])("inserts a newline on %s", async (_form, key) => {
    expect(await submitAfterKeys(["first", key, "second"])).toBe("first\nsecond");
  });
});
