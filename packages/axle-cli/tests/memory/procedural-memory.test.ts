import type { AIProvider, FileStore, MemoryContext } from "@fifthrevision/axle";
import { AxleStopReason, ToolRegistry } from "@fifthrevision/axle";
import { describe, expect, test, vi } from "vitest";
import { ProceduralMemory } from "../../src/memory/ProceduralMemory.js";

const ctx = {
  signal: new AbortController().signal,
  registry: new ToolRegistry(),
  emit: () => {},
};

function createMockProvider(responses: string[]): AIProvider {
  let callIndex = 0;
  return {
    name: "mock",
    async createGenerationRequest(_model: string, _params: any) {
      const text = responses[callIndex++] ?? "[]";
      return {
        type: "success" as const,
        role: "assistant" as const,
        id: `mock-${callIndex}`,
        model: "mock",
        text,
        content: [{ type: "text" as const, text }],
        finishReason: AxleStopReason.Stop,
        usage: { in: 5, out: 10 },
        raw: null,
      };
    },
    async *createStreamingRequest() {
      throw new Error("Not implemented");
    },
  };
}

function createMemoryStore(): FileStore & { files: Map<string, string> } {
  const files = new Map<string, string>();
  return {
    files,
    async read(path: string) {
      return files.get(path) ?? null;
    },
    async write(path: string, content: string) {
      files.set(path, content);
    },
  };
}

describe("ProceduralMemory", () => {
  function makeContext(overrides?: Partial<MemoryContext>): MemoryContext {
    return {
      sessionId: "session-1",
      messages: [],
      ...overrides,
    };
  }

  describe("recall()", () => {
    test("returns empty when no stored instructions", async () => {
      const memory = new ProceduralMemory({
        provider: createMockProvider([]),
        model: "mock",
        store: createMemoryStore(),
      });

      const result = await memory.recall(makeContext());

      expect(result.systemSuffix).toBeUndefined();
    });

    test("returns numbered systemSuffix when instructions exist", async () => {
      const store = createMemoryStore();
      const memory = new ProceduralMemory({
        provider: createMockProvider([]),
        model: "mock",
        store,
      });

      store.files.set(
        "memory/procedural/test-agent.json",
        JSON.stringify({ instructions: ["Use bullet points", "Be concise"] }),
      );

      const result = await memory.recall(makeContext({ agentName: "test-agent" }));

      expect(result.systemSuffix).toContain("## Learned Instructions");
      expect(result.systemSuffix).toContain("1. Use bullet points");
      expect(result.systemSuffix).toContain("2. Be concise");
    });
  });

  describe("record()", () => {
    test("skips when newMessages is empty", async () => {
      const provider = createMockProvider([]);
      const spy = vi.spyOn(provider, "createGenerationRequest");
      const memory = new ProceduralMemory({ provider, model: "mock", store: createMemoryStore() });

      await memory.record(makeContext({ newMessages: [] }));

      expect(spy).not.toHaveBeenCalled();
    });

    test("skips when newMessages is undefined", async () => {
      const provider = createMockProvider([]);
      const spy = vi.spyOn(provider, "createGenerationRequest");
      const memory = new ProceduralMemory({ provider, model: "mock", store: createMemoryStore() });

      await memory.record(makeContext());

      expect(spy).not.toHaveBeenCalled();
    });

    test("calls generate and saves extracted instructions", async () => {
      const provider = createMockProvider(['["Always use markdown", "Prefer short answers"]']);
      const store = createMemoryStore();
      const memory = new ProceduralMemory({ provider, model: "mock", store });
      await memory.record(
        makeContext({
          agentName: "rec-agent",
          newMessages: [
            { role: "user", content: "Use markdown please" },
            {
              role: "assistant",
              id: "a1",
              content: [{ type: "text", text: "Sure, I'll use markdown." }],
            },
          ],
        }),
      );

      const data = store.files.get("memory/procedural/rec-agent.json");
      expect(data).toBeDefined();
      const stored = JSON.parse(data!);
      expect(stored.instructions).toEqual(["Always use markdown", "Prefer short answers"]);
    });

    test("handles code-fenced JSON response", async () => {
      const provider = createMockProvider(['```json\n["Use tables for data"]\n```']);
      const store = createMemoryStore();
      const memory = new ProceduralMemory({ provider, model: "mock", store });
      await memory.record(
        makeContext({
          agentName: "fence-agent",
          newMessages: [
            { role: "user", content: "Please use tables" },
            {
              role: "assistant",
              id: "a1",
              content: [{ type: "text", text: "Got it." }],
            },
          ],
        }),
      );

      const data = store.files.get("memory/procedural/fence-agent.json");
      expect(data).toBeDefined();
      const stored = JSON.parse(data!);
      expect(stored.instructions).toEqual(["Use tables for data"]);
    });

    test("handles non-JSON gracefully", async () => {
      const provider = createMockProvider(["This is not valid JSON at all"]);
      const store = createMemoryStore();
      const memory = new ProceduralMemory({ provider, model: "mock", store });
      await memory.record(
        makeContext({
          agentName: "bad-json",
          newMessages: [
            { role: "user", content: "hello" },
            {
              role: "assistant",
              id: "a1",
              content: [{ type: "text", text: "hi" }],
            },
          ],
        }),
      );

      expect(store.files.has("memory/procedural/bad-json.json")).toBe(false);
    });

    test("appends to existing instructions", async () => {
      const store = createMemoryStore();
      store.files.set(
        "memory/procedural/append-agent.json",
        JSON.stringify({ instructions: ["Existing instruction"] }),
      );

      const provider = createMockProvider(['["New instruction"]']);
      const memory = new ProceduralMemory({ provider, model: "mock", store });

      await memory.record(
        makeContext({
          agentName: "append-agent",
          newMessages: [
            { role: "user", content: "test" },
            {
              role: "assistant",
              id: "a1",
              content: [{ type: "text", text: "ok" }],
            },
          ],
        }),
      );

      const data = store.files.get("memory/procedural/append-agent.json");
      const stored = JSON.parse(data!);
      expect(stored.instructions).toEqual(["Existing instruction", "New instruction"]);
    });
  });

  describe("tools()", () => {
    test("returns empty when enableTools is false", () => {
      const memory = new ProceduralMemory({
        provider: createMockProvider([]),
        model: "mock",
        store: createMemoryStore(),
        enableTools: false,
      });

      expect(memory.tools()).toEqual([]);
    });

    test("returns empty by default", () => {
      const memory = new ProceduralMemory({
        provider: createMockProvider([]),
        model: "mock",
        store: createMemoryStore(),
      });

      expect(memory.tools()).toEqual([]);
    });

    test("returns add_instruction tool when enableTools is true", () => {
      const memory = new ProceduralMemory({
        provider: createMockProvider([]),
        model: "mock",
        store: createMemoryStore(),
        enableTools: true,
      });

      const tools = memory.tools();
      expect(tools).toHaveLength(1);
      expect(tools[0].name).toBe("add_instruction");
    });

    test("add_instruction tool persists to store", async () => {
      const store = createMemoryStore();
      const memory = new ProceduralMemory({
        provider: createMockProvider([]),
        model: "mock",
        store,
        enableTools: true,
      });

      await memory.recall(makeContext({ agentName: "tool-agent" }));

      const tools = memory.tools();
      const result = await tools[0].execute({ instruction: "Remember this" }, ctx);

      expect(result).toContain("Remember this");

      const data = store.files.get("memory/procedural/tool-agent.json");
      const stored = JSON.parse(data!);
      expect(stored.instructions).toContain("Remember this");
    });
  });

  describe("storage path", () => {
    test("uses 'default' when no name provided", async () => {
      const provider = createMockProvider(['["test"]']);
      const store = createMemoryStore();
      const memory = new ProceduralMemory({ provider, model: "mock", store });
      await memory.record(
        makeContext({
          newMessages: [
            { role: "user", content: "test" },
            {
              role: "assistant",
              id: "a1",
              content: [{ type: "text", text: "ok" }],
            },
          ],
        }),
      );

      expect(store.files.has("memory/procedural/default.json")).toBe(true);
    });

    test("includes configured scope hash in filename", async () => {
      const store = createMemoryStore();
      const memory = new ProceduralMemory({
        provider: createMockProvider([]),
        model: "mock",
        store,
        scope: { user: "john" },
      });

      // Pre-seed with a scoped file — we need to figure out the hash.
      // Just record + recall to verify configured scope partitions storage.
      await memory.recall(makeContext({ agentName: "scoped" }));

      // Find the file that was looked up (store was empty, so no file yet)
      // Instead, write and then recall
      const provider2 = createMockProvider(['["scoped instruction"]']);
      const memory2 = new ProceduralMemory({
        provider: provider2,
        model: "mock",
        store,
        scope: { user: "john" },
      });

      await memory2.record(
        makeContext({
          agentName: "scoped",
          newMessages: [
            { role: "user", content: "test" },
            {
              role: "assistant",
              id: "a1",
              content: [{ type: "text", text: "ok" }],
            },
          ],
        }),
      );

      // Verify a scoped file was created (not just "scoped.json")
      const keys = [...store.files.keys()];
      expect(keys).toHaveLength(1);
      expect(keys[0]).toMatch(/^memory\/procedural\/scoped-[a-f0-9]+\.json$/);

      // Recall should find it
      const result = await memory.recall(makeContext({ agentName: "scoped" }));
      expect(result.systemSuffix).toContain("scoped instruction");
    });
  });
});
