import { describe, expect, test } from "vitest";
import { z } from "zod";
import { AxleError } from "../../src/errors/AxleError.js";
import { SkillRegistry } from "../../src/skills/registry.js";
import type { Skill } from "../../src/skills/types.js";
import { ToolRegistry } from "../../src/tools/registry.js";

const pdf: Skill = { name: "pdf", description: "Work with PDFs.", instructions: "Merge." };
const docx: Skill = { name: "docx", description: "Word files.", instructions: "Convert." };

function viewSkillNames(tools: ToolRegistry): string[] | undefined {
  const tool = tools.get("view-skill");
  if (!tool) return undefined;
  const shape = tool.schema.shape as { name: z.ZodEnum<Record<string, string>> };
  return Object.values(shape.name.enum);
}

describe("SkillRegistry", () => {
  test("publishes view-skill while skills are present and withdraws it at zero", () => {
    const tools = new ToolRegistry();
    const skills = new SkillRegistry(tools);
    expect(tools.get("view-skill")).toBeUndefined();

    skills.add(pdf);
    expect(viewSkillNames(tools)).toEqual(["pdf"]);

    skills.add([docx]);
    expect(viewSkillNames(tools)).toEqual(["pdf", "docx"]);
    expect(skills.list().map((skill) => skill.name)).toEqual(["pdf", "docx"]);

    expect(skills.remove("pdf")).toBe(true);
    expect(viewSkillNames(tools)).toEqual(["docx"]);

    expect(skills.remove("docx")).toBe(true);
    expect(tools.get("view-skill")).toBeUndefined();
    expect(skills.size).toBe(0);
  });

  test("seeds from the constructor and answers has and get", () => {
    const tools = new ToolRegistry();
    const skills = new SkillRegistry(tools, [pdf]);

    expect(skills.has("pdf")).toBe(true);
    expect(skills.get("pdf")).toBe(pdf);
    expect(skills.get("docx")).toBeUndefined();
    expect(viewSkillNames(tools)).toEqual(["pdf"]);
  });

  test("removing an unknown name changes nothing", () => {
    const tools = new ToolRegistry();
    const skills = new SkillRegistry(tools, [pdf]);

    expect(skills.remove("docx")).toBe(false);
    expect(viewSkillNames(tools)).toEqual(["pdf"]);
  });

  test("rejects a duplicate name and leaves the published tool as it was", () => {
    const tools = new ToolRegistry();
    const skills = new SkillRegistry(tools, [pdf]);

    expect(() => skills.add({ ...pdf, instructions: "other" })).toThrow(AxleError);
    expect(skills.get("pdf")).toBe(pdf);
    expect(viewSkillNames(tools)).toEqual(["pdf"]);
  });

  test.each(["a<b", "a>b", 'a"b', "a\nb"])(
    "rejects the name %j and leaves the published tool as it was",
    (name) => {
      const tools = new ToolRegistry();
      const skills = new SkillRegistry(tools, [pdf]);

      expect(() => skills.add([docx, { ...docx, name }])).toThrow(
        /must not contain <, >, " or line breaks/,
      );
      expect(skills.has("docx")).toBe(false);
      expect(viewSkillNames(tools)).toEqual(["pdf"]);
    },
  );

  test("never removes a host tool that happens to be named view-skill", () => {
    const hostViewSkill = {
      name: "view-skill",
      description: "the host's own",
      schema: z.object({}),
      execute: async () => "",
    };
    const tools = new ToolRegistry({ tools: [hostViewSkill] });
    const skills = new SkillRegistry(tools);

    expect(() => skills.add(pdf)).toThrow(AxleError);
    expect(tools.get("view-skill")).toBe(hostViewSkill);
  });
});
