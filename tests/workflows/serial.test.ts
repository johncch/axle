import { describe, expect, it } from "vitest";
import { Instruct } from "../../src/core/Instruct.js";
import type { AIProvider } from "../../src/providers/types.js";
import { AxleStopReason } from "../../src/providers/types.js";
import { serialWorkflow } from "../../src/workflows/serial.js";

// Mock AI provider that returns predictable responses
function createMockProvider(responses: string[]): AIProvider {
  let callIndex = 0;

  return {
    name: "mock",
    model: "mock-model",
    async createGenerationRequest() {
      const response = responses[callIndex] || "default response";
      callIndex++;

      return {
        type: "success",
        id: `mock-${callIndex}`,
        model: "mock-model",
        role: "assistant",
        finishReason: AxleStopReason.Stop,
        content: [{ type: "text", text: `<response>${response}</response>` }],
        text: `<response>${response}</response>`,
        usage: { in: 10, out: 20 },
        raw: {},
      };
    },
  };
}

describe("serialWorkflow", () => {
  describe("with Instruct steps", () => {
    it("should execute a single Instruct step", async () => {
      const provider = createMockProvider(["Hello, World!"]);
      const instruct = Instruct.with("Say hello");

      const workflow = serialWorkflow(instruct);
      const result = await workflow.execute({
        provider,
        variables: {},
      });

      expect(result.success).toBe(true);
      expect(result.response).toEqual({ response: "Hello, World!" });
    });

    it("should execute multiple Instruct steps in sequence", async () => {
      const provider = createMockProvider(["First response", "Second response"]);
      const instruct1 = Instruct.with("Step 1");
      const instruct2 = Instruct.with("Step 2");

      const workflow = serialWorkflow(instruct1, instruct2);
      const result = await workflow.execute({
        provider,
        variables: {},
      });

      expect(result.success).toBe(true);
      // Final result should be from the last step
      expect(result.response).toEqual({ response: "Second response" });
    });

    it("should pass variables to Instruct steps", async () => {
      const provider = createMockProvider(["Greeting sent"]);
      const instruct = Instruct.with("Say hello to {{name}}");

      const workflow = serialWorkflow(instruct);
      const result = await workflow.execute({
        provider,
        variables: { name: "Alice" },
      });

      expect(result.success).toBe(true);
    });

    it("should accumulate stats across steps", async () => {
      const provider = createMockProvider(["Response 1", "Response 2"]);
      const instruct1 = Instruct.with("Step 1");
      const instruct2 = Instruct.with("Step 2");

      const stats = { in: 0, out: 0 };
      const workflow = serialWorkflow(instruct1, instruct2);
      await workflow.execute({
        provider,
        variables: {},
        stats,
      });

      // Each call adds 10 in and 20 out
      expect(stats.in).toBe(20);
      expect(stats.out).toBe(40);
    });
  });

  describe("workflow result", () => {
    it("should return $previous as the final response", async () => {
      const provider = createMockProvider(["Final answer"]);
      const instruct = Instruct.with("Answer");

      const workflow = serialWorkflow(instruct);
      const result = await workflow.execute({
        provider,
        variables: {},
      });

      expect(result.response).toEqual({ response: "Final answer" });
    });

    it("should return success: true on successful execution", async () => {
      const provider = createMockProvider(["Success"]);
      const instruct = Instruct.with("Test");

      const workflow = serialWorkflow(instruct);
      const result = await workflow.execute({
        provider,
        variables: {},
      });

      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it("should return stats in the result", async () => {
      const provider = createMockProvider(["Response"]);
      const instruct = Instruct.with("Test");

      const stats = { in: 5, out: 10 };
      const workflow = serialWorkflow(instruct);
      const result = await workflow.execute({
        provider,
        variables: {},
        stats,
      });

      expect(result.stats).toBe(stats);
      expect(stats.in).toBe(15); // 5 + 10
      expect(stats.out).toBe(30); // 10 + 20
    });
  });

  describe("options handling", () => {
    it("should skip Instruct execution in dry run mode", async () => {
      const provider = createMockProvider([]);
      const instruct = Instruct.with("Test");

      const workflow = serialWorkflow(instruct);
      const result = await workflow.execute({
        provider,
        variables: {},
        options: { dryRun: true },
      });

      expect(result.success).toBe(true);
      // In dry run, no actual LLM call is made
    });
  });
});
