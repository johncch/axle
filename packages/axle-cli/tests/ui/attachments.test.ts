import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  decodeBase64Image,
  nextPlaceholder,
  pastedImagePath,
  resolveInput,
  stripReserved,
  type Attachment,
} from "../../src/ui/ink/attachments.js";

const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

describe("pastedImagePath", () => {
  it.each([
    ["a plain absolute path", "/tmp/shot.png", "/tmp/shot.png"],
    ["backslash-escaped spaces", "/tmp/My\\ Shot\\ (1).png", "/tmp/My Shot (1).png"],
    ["single quotes", "'/tmp/My Shot.jpeg'", "/tmp/My Shot.jpeg"],
    ["double quotes", '"/tmp/My Shot.webp"', "/tmp/My Shot.webp"],
    ["a file URL", "file:///tmp/My%20Shot.gif", "/tmp/My Shot.gif"],
    ["a home-relative path", "~/Desktop/shot.PNG", join(homedir(), "Desktop/shot.PNG")],
    ["surrounding whitespace", "  /tmp/shot.jpg\n", "/tmp/shot.jpg"],
  ])("reads %s", (_form, pasted, path) => {
    expect(pastedImagePath(pasted)).toBe(path);
  });

  it.each([
    ["a relative path", "shots/shot.png"],
    ["a file that is not an image", "/tmp/notes.md"],
    ["a path inside a sentence", "see /tmp/shot.png"],
    ["two paths on two lines", "/tmp/a.png\n/tmp/b.png"],
    ["an empty paste", ""],
  ])("ignores %s", (_form, pasted) => {
    expect(pastedImagePath(pasted)).toBeUndefined();
  });
});

describe("decodeBase64Image", () => {
  it("ignores base64 that does not decode to an image", () => {
    const text = Buffer.from("just some ordinary text that happens to be long enough").toString(
      "base64",
    );
    expect(decodeBase64Image(text)).toBeUndefined();
  });

  it("ignores prose that starts like image data", () => {
    expect(decodeBase64Image(`${PNG_BASE64.slice(0, 40)} and then some words follow it`)).toBe(
      undefined,
    );
  });

  it("names the file after its type", () => {
    expect(decodeBase64Image(PNG_BASE64)?.name).toBe("pasted-image.png");
  });
});

describe("placeholders", () => {
  it("drops reserved characters from incoming text", () => {
    expect(stripReserved("abc")).toBe("abc");
  });

  it("stops handing out placeholders once the reserved range is used up", () => {
    const table = new Map<string, Attachment>();
    // The reserved range U+E100–U+E1FF holds 256 placeholders.
    for (let index = 0; index < 256; index++) {
      table.set(nextPlaceholder(table)!, { kind: "paste", text: "" });
    }
    expect(nextPlaceholder(table)).toBeUndefined();
  });

  it("ignores attachments whose placeholder was deleted from the text", () => {
    const table = new Map<string, Attachment>([["", { kind: "paste", text: "gone" }]]);
    expect(resolveInput("still here", table)).toEqual({ text: "still here", images: [] });
  });
});
