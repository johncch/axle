import { describe, expect, it } from "vitest";
import { AxleError } from "../../src/errors/AxleError.js";
import { parseSkillMarkdown } from "../../src/skills/parse.js";

describe("parseSkillMarkdown", () => {
  it("splits the frontmatter from the body", () => {
    const skill = parseSkillMarkdown(
      [
        "---",
        "name: pdf",
        "description: Work with PDFs.",
        "---",
        "",
        "# PDF",
        "",
        "Merge things.",
        "",
      ].join("\n"),
    );

    expect(skill).toEqual({
      name: "pdf",
      description: "Work with PDFs.",
      instructions: "# PDF\n\nMerge things.",
    });
  });

  it("carries the optional fields through untouched", () => {
    const skill = parseSkillMarkdown(
      [
        "---",
        "name: pdf",
        "description: Work with PDFs.",
        "license: Apache-2.0",
        "compatibility: Requires Python 3.14+",
        "allowed-tools: Bash(git:*) Read",
        "metadata:",
        "  author: example-org",
        '  version: "1.0"',
        "---",
        "Body.",
      ].join("\n"),
    );

    expect(skill.frontmatter).toEqual({
      license: "Apache-2.0",
      compatibility: "Requires Python 3.14+",
      "allowed-tools": "Bash(git:*) Read",
      metadata: { author: "example-org", version: "1.0" },
    });
    expect(skill.instructions).toBe("Body.");
  });

  it("omits frontmatter when only the required fields are present", () => {
    const skill = parseSkillMarkdown("---\nname: a\ndescription: b\n---\n");

    expect("frontmatter" in skill).toBe(false);
    expect(skill.instructions).toBe("");
  });

  it("accepts CRLF line endings and a leading blank line", () => {
    const skill = parseSkillMarkdown("\r\n---\r\nname: a\r\ndescription: b\r\n---\r\nBody.\r\n");

    expect(skill).toEqual({ name: "a", description: "b", instructions: "Body." });
  });

  it("loads a name the specification would reject as written", () => {
    expect(parseSkillMarkdown("---\nname: PDF Tools\ndescription: b\n---\n").name).toBe(
      "PDF Tools",
    );
  });

  it.each([
    ["an opening angle bracket", "name: a<b"],
    ["a closing angle bracket", "name: a>b"],
    ["a double quote", "name: 'a\"b'"],
    ["a line break", "name: |\n  a\n  b"],
  ])("rejects a name containing %s", (_label, nameLine) => {
    const parse = () => parseSkillMarkdown(`---\n${nameLine}\ndescription: b\n---\n`);

    expect(parse).toThrow(AxleError);
    expect(parse).toThrow(/name: must not contain <, >, " or line breaks/);
  });

  it("rejects text without a frontmatter block", () => {
    expect(() => parseSkillMarkdown("# Just a heading\n")).toThrow(AxleError);
    expect(() => parseSkillMarkdown("# Just a heading\n")).toThrow(/frontmatter/);
  });

  it("rejects a missing or empty description", () => {
    expect(() => parseSkillMarkdown("---\nname: pdf\n---\nBody")).toThrow(
      /description: Invalid input/,
    );
    expect(() => parseSkillMarkdown('---\nname: pdf\ndescription: ""\n---\n')).toThrow(
      /description: must be a non-empty string/,
    );
  });

  it("rejects a missing name", () => {
    expect(() => parseSkillMarkdown("---\ndescription: b\n---\n")).toThrow(/name/);
  });

  it("rejects frontmatter that is not valid YAML", () => {
    expect(() => parseSkillMarkdown("---\nname: [\ndescription: b\n---\n")).toThrow(
      /not valid YAML/,
    );
  });

  it("rejects frontmatter that is not a mapping", () => {
    expect(() => parseSkillMarkdown("---\n- a\n- b\n---\n")).toThrow(/mapping/);
  });

  it("reads unquoted numbers and booleans as text, as the specification types them", () => {
    const skill = parseSkillMarkdown(
      [
        "---",
        "name: a",
        "description: b",
        "metadata:",
        "  version: 1.0",
        "  experimental: true",
        "---",
      ].join("\n"),
    );

    expect(skill.frontmatter?.metadata).toEqual({ version: "1.0", experimental: "true" });
  });

  it("type-checks the optional fields the specification names", () => {
    expect(() => parseSkillMarkdown("---\nname: a\ndescription: b\nmetadata: nope\n---\n")).toThrow(
      /metadata/,
    );
  });
});
