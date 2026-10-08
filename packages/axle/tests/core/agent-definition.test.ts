import { describe, expect, test } from "vitest";
import { z } from "zod";
import {
  createAgentConfig,
  MCP,
  type AgentDefinition,
  type AIProvider,
  type ExecutableTool,
} from "../../src/index.js";
import type { Skill } from "../../src/skills/types.js";

function createProvider(): AIProvider {
  return {
    name: "definition-provider",
    async *createStreamingRequest() {
      throw new Error("not used");
    },
  };
}

describe("createAgentConfig", () => {
  test("resolves a serializable definition into runtime agent config", async () => {
    const tool: ExecutableTool = {
      name: "lookup",
      description: "Lookup",
      schema: z.object({ query: z.string() }),
      async execute() {
        return "ok";
      },
    };
    const definition: AgentDefinition = {
      version: 1,
      name: "assistant",
      provider: { type: "mock", config: { apiKeyEnv: "MOCK_API_KEY" } },
      model: "mock-model",
      system: "Be direct.",
      request: {
        maxOutputTokens: 1000,
        providerOptions: { seed: 7 },
      },
      tools: [{ name: "lookup", config: { scope: "docs" } }],
      providerTools: [{ name: "web_search", config: { region: "us" } }],
      mcps: [{ transport: "stdio", name: "local", command: "node", args: ["server.js"] }],
    };

    const config = await createAgentConfig(definition, (agentDefinition) => {
      expect(agentDefinition).toEqual(definition);

      return {
        provider: createProvider(),
        tools: [tool],
      };
    });

    expect(config).toMatchObject({
      model: "mock-model",
      system: "Be direct.",
      name: "assistant",
      tools: [tool],
      providerTools: [{ type: "provider", name: "web_search", config: { region: "us" } }],
      maxOutputTokens: 1000,
      providerOptions: { seed: 7 },
    });
    expect(config.provider.name).toBe("definition-provider");
    expect(config.mcps).toHaveLength(1);
    expect(config.mcps?.[0]).toBeInstanceOf(MCP);
  });

  test("requires resolved tools when executable tool references are present", async () => {
    await expect(
      createAgentConfig(
        {
          version: 1,
          provider: { type: "mock" },
          model: "mock-model",
          tools: [{ name: "lookup" }],
        },
        () => ({ provider: createProvider() }),
      ),
    ).rejects.toThrow("AgentDefinition includes tools but resolver did not return tools");
  });

  test("passes resolved skills through to the config", async () => {
    const pdf: Skill = {
      name: "pdf",
      description: "Work with PDFs.",
      instructions: "Run scripts/merge.py.",
      root: "/skills/pdf",
    };
    const definition: AgentDefinition = {
      version: 1,
      provider: { type: "mock" },
      model: "mock-model",
      skills: [{ name: "pdf" }],
    };

    const config = await createAgentConfig(definition, async (def) => ({
      provider: createProvider(),
      skills: def.skills
        ?.map((ref) => (ref.name === "pdf" ? pdf : undefined))
        .filter((skill) => skill !== undefined),
    }));

    expect(config.skills).toEqual([pdf]);
  });

  test("requires resolved skills when skill references are present", async () => {
    await expect(
      createAgentConfig(
        {
          version: 1,
          provider: { type: "mock" },
          model: "mock-model",
          skills: [{ name: "pdf" }],
        },
        async () => ({ provider: createProvider() }),
      ),
    ).rejects.toThrow("AgentDefinition includes skills but resolver did not return skills");
  });

  test("leaves skills undefined when the definition names none", async () => {
    const config = await createAgentConfig(
      { version: 1, provider: { type: "mock" }, model: "mock-model" },
      async () => ({ provider: createProvider() }),
    );

    expect(config.skills).toBeUndefined();
  });

  test("allows empty executable tool references without resolved tools", async () => {
    const config = await createAgentConfig(
      {
        version: 1,
        provider: { type: "mock" },
        model: "mock-model",
        tools: [],
      },
      () => ({ provider: createProvider() }),
    );

    expect(config.tools).toBeUndefined();
  });

  test("uses resolved model when model is omitted", async () => {
    const config = await createAgentConfig(
      {
        version: 1,
        provider: { type: "mock" },
      },
      () => ({ provider: createProvider(), model: "resolved-model" }),
    );

    expect(config.model).toBe("resolved-model");
  });

  test("requires model or resolved model", async () => {
    await expect(
      createAgentConfig(
        {
          version: 1,
          provider: { type: "mock" },
        },
        () => ({ provider: createProvider() }),
      ),
    ).rejects.toThrow("AgentDefinition requires a model or model resolver");
  });

  test("rejects unsupported definition versions", async () => {
    await expect(
      createAgentConfig(
        {
          version: 2,
          provider: { type: "mock" },
          model: "mock-model",
        } as any,
        () => ({ provider: createProvider() }),
      ),
    ).rejects.toThrow("Unsupported agent definition version: 2");
  });
});
