import { describe, expect, it } from "vitest";
import { renderTerminalMarkdown } from "../../src/utils/markdown.js";

// eslint-disable-next-line no-control-regex
const stripAnsi = (s: string) => s.replace(/\u001b\[[0-9;]*m/g, "");
const render = (md: string) => stripAnsi(renderTerminalMarkdown(md));

describe("renderTerminalMarkdown", () => {
  it("separates blocks with a blank line and drops heading and emphasis markers", () => {
    expect(render("# Title\n\nSome **bold** and `code`.\n\nNext.")).toBe(
      "Title\n\nSome bold and code.\n\nNext.",
    );
  });

  it("keeps tight lists tight and spaces loose ones", () => {
    expect(render("1. first\n2. second\n\n- a\n- b")).toBe("1. first\n2. second\n\n- a\n- b");
    expect(render("- a\n\n  more a\n\n- b")).toBe("- a\n\n  more a\n\n- b");
  });

  it("gives fenced code a gutter and no language label", () => {
    expect(render("```sh\naxle -j job.yaml\naxle setup\n```")).toBe(
      "│ axle -j job.yaml\n│ axle setup",
    );
  });

  it("aligns table columns under a rule", () => {
    expect(render("| Command | Does |\n|---|---|\n| `axle` | chat |\n| `axle -j x` | run |")).toBe(
      "Command    Does\n─────────  ────\naxle       chat\naxle -j x  run",
    );
  });
});
