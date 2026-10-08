import { describe, expect, it } from "vitest";
import { z } from "zod";
import { Agent } from "../../src/core/agent/index.js";
import { AxleError } from "../../src/errors/AxleError.js";
import type { AnyStreamChunk } from "../../src/messages/stream.js";
import type { AIProvider } from "../../src/providers/types.js";
import type { Skill } from "../../src/skills/types.js";
import type { ExecutableTool } from "../../src/tools/types.js";

const provider: AIProvider = {
  name: "never-called",
  async *createStreamingRequest(): AsyncGenerator<AnyStreamChunk, void, unknown> {
    throw new Error("not expected");
  },
};

const pdf: Skill = {
  name: "pdf",
  description: "Work with PDFs.",
  instructions: "Run scripts/merge.py.",
  root: "/skills/pdf",
};

describe("Agent with skills", () => {
  it("appends the catalog to the system prompt and registers view-skill", () => {
    const agent = new Agent({ provider, model: "m", system: "Be brief.", skills: [pdf] });

    expect(agent.system?.startsWith("Be brief.\n\n# Skills\n")).toBe(true);
    expect(agent.system).toContain("- pdf: Work with PDFs.");
    expect(agent.registry.get("view-skill")).toBeDefined();
    expect(agent.hasTools()).toBe(true);
  });

  it("uses the catalog alone when there is no system prompt", () => {
    const agent = new Agent({ provider, model: "m", skills: [pdf] });

    expect(agent.system?.startsWith("# Skills")).toBe(true);
  });

  it("counts the catalog and the tool in the context estimate", () => {
    const without = new Agent({ provider, model: "m", system: "Be brief." });
    const withSkills = new Agent({ provider, model: "m", system: "Be brief.", skills: [pdf] });

    expect(withSkills.context().system).toBeGreaterThan(without.context().system);
    expect(withSkills.context().tools).toBeGreaterThan(without.context().tools);
  });

  it("adds nothing for an empty skills list", () => {
    const agent = new Agent({ provider, model: "m", system: "Be brief.", skills: [] });

    expect(agent.system).toBe("Be brief.");
    expect(agent.registry.get("view-skill")).toBeUndefined();
    expect(agent.hasTools()).toBe(false);
  });

  it("rejects a host tool that collides with view-skill", () => {
    const hostViewSkill: ExecutableTool = {
      name: "view-skill",
      description: "the host's own",
      schema: z.object({}),
      execute: async () => "",
    };

    expect(
      () => new Agent({ provider, model: "m", tools: [hostViewSkill], skills: [pdf] }),
    ).toThrow(AxleError);
  });
});
