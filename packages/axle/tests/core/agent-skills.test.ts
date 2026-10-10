import { describe, expect, it } from "vitest";
import { z } from "zod";
import { Agent } from "../../src/core/agent/index.js";
import { AxleError } from "../../src/errors/AxleError.js";
import type { AnyStreamChunk } from "../../src/messages/stream.js";
import type { AIProvider } from "../../src/providers/types.js";
import { AxleStopReason } from "../../src/providers/types.js";
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

interface SeenRequest {
  system: string | undefined;
  tools: string[] | undefined;
}

function recordingProvider(steps: ("text" | { call: string })[]): {
  provider: AIProvider;
  requests: SeenRequest[];
} {
  const requests: SeenRequest[] = [];
  let index = 0;
  const provider: AIProvider = {
    name: "recording",
    async *createStreamingRequest(_model, params): AsyncGenerator<AnyStreamChunk, void, unknown> {
      requests.push({ system: params.system, tools: params.tools?.map((tool) => tool.name) });
      const step = steps[index++];
      if (!step) throw new Error("No step configured");
      yield { type: "start", id: `r${index}`, data: { model: "m", timestamp: 0 } };
      if (step === "text") {
        yield { type: "text-start", data: { index: 0 } };
        yield { type: "text-delta", data: { index: 0, text: "ok" } };
        yield { type: "text-complete", data: { index: 0 } };
        yield {
          type: "complete",
          data: { finishReason: AxleStopReason.Stop, usage: { in: 1, out: 1 } },
        };
      } else {
        yield { type: "tool-call-start", data: { index: 0, id: "c1", name: step.call } };
        yield {
          type: "tool-call-complete",
          data: { index: 0, id: "c1", name: step.call, arguments: {} },
        };
        yield {
          type: "complete",
          data: { finishReason: AxleStopReason.FunctionCall, usage: { in: 1, out: 1 } },
        };
      }
    },
  };
  return { provider, requests };
}

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

  it("exposes the skills as a registry the host can change between turns", async () => {
    const { provider, requests } = recordingProvider(["text", "text", "text"]);
    const agent = new Agent({ provider, model: "m", system: "Be brief." });

    await agent.send("one").final;
    agent.skills.add(pdf);
    await agent.send("two").final;
    agent.skills.remove("pdf");
    await agent.send("three").final;

    expect(requests.map((request) => request.tools)).toEqual([
      undefined,
      ["view-skill"],
      undefined,
    ]);
    expect(requests[0]?.system).toBe("Be brief.");
    expect(requests[1]?.system).toContain("- pdf: Work with PDFs.");
    expect(requests[2]?.system).toBe("Be brief.");
    expect(agent.system).toBe("Be brief.");
  });

  it("lets a tool add a skill mid-turn, visible on the next request", async () => {
    const { provider, requests } = recordingProvider([{ call: "activate" }, "text"]);
    const activate: ExecutableTool = {
      name: "activate",
      description: "connects a source of skills",
      schema: z.object({}),
      execute: async () => {
        agent.skills.add(pdf);
        return "connected";
      },
    };
    const agent = new Agent({ provider, model: "m", system: "Be brief.", tools: [activate] });

    await agent.send("go").final;

    expect(requests.map((request) => request.tools)).toEqual([
      ["activate"],
      ["activate", "view-skill"],
    ]);
    expect(requests[0]?.system).toBe("Be brief.");
    expect(requests[1]?.system).toContain("- pdf: Work with PDFs.");
  });

  it("removing the last skill withdraws the catalog and the tool", () => {
    const agent = new Agent({ provider, model: "m", system: "Be brief.", skills: [pdf] });

    expect(agent.skills.remove("pdf")).toBe(true);

    expect(agent.system).toBe("Be brief.");
    expect(agent.registry.get("view-skill")).toBeUndefined();
    expect(agent.hasTools()).toBe(false);
  });

  it("counts skills added later in the context estimate", () => {
    const agent = new Agent({ provider, model: "m", system: "Be brief." });
    const before = agent.context();

    agent.skills.add(pdf);

    expect(agent.context().system).toBeGreaterThan(before.system);
    expect(agent.context().tools).toBeGreaterThan(before.tools);
  });

  it("rejects a skill added later when a host tool holds the view-skill name", () => {
    const hostViewSkill: ExecutableTool = {
      name: "view-skill",
      description: "the host's own",
      schema: z.object({}),
      execute: async () => "",
    };
    const agent = new Agent({ provider, model: "m", tools: [hostViewSkill] });

    expect(() => agent.skills.add(pdf)).toThrow(AxleError);
    expect(agent.registry.get("view-skill")).toBe(hostViewSkill);
  });
});
