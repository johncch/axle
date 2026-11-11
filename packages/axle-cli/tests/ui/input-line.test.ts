import type { FileInfo } from "@fifthrevision/axle";
import { render } from "ink";
import { PassThrough } from "node:stream";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { App, type ImageSources } from "../../src/ui/ink/App.js";
import type { UiState } from "../../src/ui/ink/store.js";
import { UiStore } from "../../src/ui/ink/store.js";
import type { ChatInput } from "../../src/ui/renderer.js";

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

interface Session {
  submitted: ChatInput | null | undefined;
  screen: string;
}

const PNG: FileInfo = {
  kind: "image",
  mimeType: "image/png",
  name: "shot.png",
  source: { type: "base64", data: "" },
};

const NO_IMAGES: ImageSources = {
  readClipboard: async () => ({ status: "none" }),
  loadFile: async () => undefined,
};

// Ink paints at most every ~33ms, so a frame between two keys is only on
// screen when the keys are further apart than that.
const PAINT_MS = 50;

async function runKeys(
  keys: string[],
  options: {
    imageInput?: boolean;
    imageSources?: Partial<ImageSources>;
    keyDelayMs?: number;
  } = {},
): Promise<Session> {
  const stdin = new FakeTty();
  const stdout = new FakeTty();
  const session: Session = { submitted: undefined, screen: "" };
  stdout.on("data", (chunk: Buffer) => {
    session.screen += chunk.toString();
  });
  const store = new UiStore<UiState>({
    staticItems: [],
    awaitingInput: true,
    pending: [],
    queuedInputs: [],
    imageInput: options.imageInput,
  });
  const instance = render(
    createElement(App, {
      store,
      statusBar: false,
      imageSources: { ...NO_IMAGES, ...options.imageSources },
      onSubmit(value: ChatInput | null) {
        session.submitted = value;
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
    await new Promise((resolve) => setTimeout(resolve, options.keyDelayMs ?? 10));
  }
  instance.unmount();
  return session;
}

async function submitAfterKeys(keys: string[]): Promise<string | undefined> {
  return (await runKeys(keys)).submitted?.text;
}

function paste(text: string): string {
  return `\x1b[200~${text}\x1b[201~`;
}

function lines(count: number): string {
  return Array.from({ length: count }, (_, index) => `line ${index + 1}`).join("\n");
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
const CTRL_Z = "\x1a";
const CMD_Z_AS_KITTY = "\x1b[122;9u";
const CMD_SHIFT_Z_AS_KITTY = "\x1b[122;10u";
const CTRL_SHIFT_Z_AS_KITTY = "\x1b[122;6u";
const CTRL_V = "\x16";
const BACKSPACE = "\x7f";

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

  it.each([
    ["Ctrl-Z", CTRL_Z],
    ["Cmd-Z under the kitty protocol", CMD_Z_AS_KITTY],
  ])("undoes the last edit on %s", async (_form, key) => {
    expect(await submitAfterKeys(["keep this", CTRL_W, key])).toBe("keep this");
  });

  it.each([
    ["Cmd-Shift-Z", CMD_SHIFT_Z_AS_KITTY],
    ["Ctrl-Shift-Z", CTRL_SHIFT_Z_AS_KITTY],
  ])("redoes on %s under the kitty protocol", async (_form, key) => {
    expect(await submitAfterKeys(["keep this", CTRL_W, CTRL_Z, key])).toBe("keep ");
  });
});

describe("chat input pastes", () => {
  it("keeps a short paste inline", async () => {
    const { submitted } = await runKeys(["run ", paste("pnpm test")]);
    expect(submitted).toEqual({ text: "run pnpm test", images: [] });
  });

  it("collapses a paste of more than 5 lines and sends it in full", async () => {
    const { submitted, screen } = await runKeys(["why? ", paste(lines(6))], {
      keyDelayMs: PAINT_MS,
    });
    expect(screen).toContain("why? [Pasted 6 lines]");
    expect(submitted).toEqual({
      text: `why? ${lines(6)}`,
      display: "why? [Pasted 6 lines]",
      images: [],
    });
  });

  it("keeps a 5-line paste inline", async () => {
    const { submitted } = await runKeys([paste(lines(5))]);
    expect(submitted).toEqual({ text: lines(5), images: [] });
  });

  it("collapses a one-line paste of more than 500 characters", async () => {
    const { submitted } = await runKeys([paste("x".repeat(501))]);
    expect(submitted?.display).toBe("[Pasted 501 characters]");
  });

  it("counts lines after normalising carriage returns", async () => {
    const { submitted } = await runKeys([paste(lines(6).replaceAll("\n", "\r"))]);
    expect(submitted).toEqual({ text: lines(6), display: "[Pasted 6 lines]", images: [] });
  });

  it("removes the whole paste on Backspace", async () => {
    const { submitted } = await runKeys(["keep ", paste(lines(6)), BACKSPACE]);
    expect(submitted).toEqual({ text: "keep ", images: [] });
  });

  it("restores a removed paste on undo", async () => {
    const { submitted } = await runKeys([paste(lines(6)), BACKSPACE, CTRL_Z]);
    expect(submitted?.text).toBe(lines(6));
  });

  it("types at the cursor on either side of a collapsed paste", async () => {
    const { submitted } = await runKeys([paste(lines(6)), LEFT, "before ", "\x1b[C", " after"]);
    expect(submitted?.display).toBe("before [Pasted 6 lines] after");
  });
});

describe("chat input images", () => {
  it("attaches the clipboard image on Ctrl-V", async () => {
    const { submitted, screen } = await runKeys([CTRL_V, " what is this?"], {
      keyDelayMs: PAINT_MS,
      imageSources: { readClipboard: async () => ({ status: "image", file: PNG }) },
    });
    expect(screen).toContain("[Image 1]");
    expect(submitted).toEqual({
      text: "[Image 1] what is this?",
      display: "[Image 1] what is this?",
      images: [PNG],
    });
  });

  it("attaches the clipboard image on an empty paste", async () => {
    const { submitted } = await runKeys([paste("")], {
      imageSources: { readClipboard: async () => ({ status: "image", file: PNG }) },
    });
    expect(submitted?.images).toEqual([PNG]);
  });

  it("attaches a pasted path to an image file", async () => {
    const loaded: string[] = [];
    const { submitted } = await runKeys([paste("/tmp/My\\ Shot.png")], {
      imageSources: {
        loadFile: async (path) => {
          loaded.push(path);
          return PNG;
        },
      },
    });
    expect(loaded).toEqual(["/tmp/My Shot.png"]);
    expect(submitted?.images).toEqual([PNG]);
  });

  it("keeps a pasted image path as text when the file cannot be loaded", async () => {
    const { submitted } = await runKeys([paste("/tmp/missing.png")]);
    expect(submitted).toEqual({ text: "/tmp/missing.png", images: [] });
  });

  it("attaches pasted base64 image data", async () => {
    const data =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const { submitted } = await runKeys([paste(`${data.slice(0, 76)}\r${data.slice(76)}\r`)]);
    expect(submitted?.images).toEqual([
      {
        kind: "image",
        mimeType: "image/png",
        name: "pasted-image.png",
        size: 70,
        source: { type: "base64", data },
      },
    ]);
  });

  it("numbers images in the order they appear", async () => {
    const second: FileInfo = { ...PNG, name: "second.png" };
    const files = [PNG, second];
    const { submitted } = await runKeys([CTRL_V, CTRL_V, LEFT, LEFT, "\x1b[3~"], {
      imageSources: { readClipboard: async () => ({ status: "image", file: files.shift()! }) },
    });
    expect(submitted).toEqual({ text: "[Image 1]", display: "[Image 1]", images: [second] });
  });

  it("removes the attachment on Backspace", async () => {
    const { submitted } = await runKeys([CTRL_V, BACKSPACE, "text only"], {
      imageSources: { readClipboard: async () => ({ status: "image", file: PNG }) },
    });
    expect(submitted).toEqual({ text: "text only", images: [] });
  });

  it("says so when the clipboard holds no image", async () => {
    const { submitted, screen } = await runKeys([CTRL_V], { keyDelayMs: PAINT_MS });
    expect(screen).toContain("No image on the clipboard");
    expect(submitted).toEqual({ text: "", images: [] });
  });

  it("refuses an image at paste time when the model does not accept images", async () => {
    const { submitted, screen } = await runKeys([CTRL_V], {
      keyDelayMs: PAINT_MS,
      imageInput: false,
      imageSources: { readClipboard: async () => ({ status: "image", file: PNG }) },
    });
    expect(screen).toContain("This model does not accept images");
    expect(submitted).toEqual({ text: "", images: [] });
  });
});
