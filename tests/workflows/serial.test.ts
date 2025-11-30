import { describe, expect, it } from "@jest/globals";
import type { Action, ActionContext } from "../../src/actions/types.js";
import type { AIProvider } from "../../src/ai/types.js";
import { AxleStopReason } from "../../src/ai/types.js";
import { Instruct } from "../../src/core/Instruct.js";
import { serialWorkflow } from "../../src/workflows/serial.js";

// Mock AI provider that returns predictable responses
function createMockProvider(responses: string[]): AIProvider {
  let callIndex = 0;

  return {
    name: "mock",
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

// Simple action for testing that captures what it receives
class TestAction implements Action {
  name = "test-action";
  executeCalls: ActionContext[] = [];
  returnValue: string | void;

  constructor(returnValue?: string) {
    this.returnValue = returnValue;
  }

  async execute(context: ActionContext): Promise<string | void> {
    // Capture a snapshot of the context at execution time
    this.executeCalls.push({
      input: context.input,
      variables: { ...context.variables },
      options: context.options,
      recorder: context.recorder,
    });
    return this.returnValue;
  }
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

  describe("with Action steps", () => {
    it("should execute a single Action step", async () => {
      const provider = createMockProvider([]);
      const action = new TestAction("action output");

      const workflow = serialWorkflow(action);
      const result = await workflow.execute({
        provider,
        variables: {},
      });

      expect(result.success).toBe(true);
      expect(action.executeCalls).toHaveLength(1);
    });

    it("should pass input to Action from $previous", async () => {
      const provider = createMockProvider(["LLM response"]);
      const instruct = Instruct.with("Generate something");
      const action = new TestAction();

      const workflow = serialWorkflow(instruct, action);
      await workflow.execute({
        provider,
        variables: {},
      });

      expect(action.executeCalls).toHaveLength(1);
      // Action should receive input derived from $previous.response
      expect(action.executeCalls[0].input).toBe("LLM response");
    });

    it("should pass variables to Action context", async () => {
      const provider = createMockProvider([]);
      const action = new TestAction();

      const workflow = serialWorkflow(action);
      await workflow.execute({
        provider,
        variables: { customVar: "custom value" },
      });

      expect(action.executeCalls[0].variables.customVar).toBe("custom value");
    });

    it("should update $previous with Action output and pass to next action", async () => {
      const provider = createMockProvider([]);
      const action1 = new TestAction("first output");
      const action2 = new TestAction();

      const workflow = serialWorkflow(action1, action2);
      await workflow.execute({
        provider,
        variables: {},
      });

      // Action output is wrapped in { output: ... } for $previous
      // deriveInput stringifies the whole object when response is not present
      expect(action2.executeCalls[0].input).toBe('{"output":"first output"}');
    });

    it("should handle Action returning void", async () => {
      const provider = createMockProvider([]);
      const action = new TestAction(); // returns undefined

      const workflow = serialWorkflow(action);
      const result = await workflow.execute({
        provider,
        variables: {},
      });

      expect(result.success).toBe(true);
    });
  });

  describe("with mixed Instruct and Action steps", () => {
    it("should execute Instruct followed by Action", async () => {
      const provider = createMockProvider(["Generated content"]);
      const instruct = Instruct.with("Generate content");
      const action = new TestAction();

      const workflow = serialWorkflow(instruct, action);
      const result = await workflow.execute({
        provider,
        variables: {},
      });

      expect(result.success).toBe(true);
      expect(action.executeCalls).toHaveLength(1);
      expect(action.executeCalls[0].input).toBe("Generated content");
    });

    it("should execute Action followed by Instruct", async () => {
      const provider = createMockProvider(["Final response"]);
      const action = new TestAction("prepared input");
      const instruct = Instruct.with("Process this: {{output}}");

      const workflow = serialWorkflow(action, instruct);
      const result = await workflow.execute({
        provider,
        variables: {},
      });

      expect(result.success).toBe(true);
      expect(result.response).toEqual({ response: "Final response" });
    });

    it("should handle complex pipeline: Instruct -> Action -> Instruct", async () => {
      const provider = createMockProvider(["First LLM output", "Second LLM output"]);
      const instruct1 = Instruct.with("First step");
      const action = new TestAction("processed");
      const instruct2 = Instruct.with("Second step with {{output}}");

      const workflow = serialWorkflow(instruct1, action, instruct2);
      const result = await workflow.execute({
        provider,
        variables: {},
      });

      expect(result.success).toBe(true);
      expect(action.executeCalls[0].input).toBe("First LLM output");
      expect(result.response).toEqual({ response: "Second LLM output" });
    });
  });

  describe("$previous behavior", () => {
    it("should derive input from $previous.response if present", async () => {
      const provider = createMockProvider([]);
      const action = new TestAction();

      const workflow = serialWorkflow(action);
      await workflow.execute({
        provider,
        variables: {
          $previous: { response: "previous response" },
        },
      });

      expect(action.executeCalls[0].input).toBe("previous response");
    });

    it("should stringify $previous if response is not present", async () => {
      const provider = createMockProvider([]);
      const action = new TestAction();

      const workflow = serialWorkflow(action);
      await workflow.execute({
        provider,
        variables: {
          $previous: { custom: "value", another: 123 },
        },
      });

      expect(action.executeCalls[0].input).toBe('{"custom":"value","another":123}');
    });

    it("should derive input as empty string when $previous is undefined", async () => {
      const provider = createMockProvider([]);
      const action = new TestAction();

      const workflow = serialWorkflow(action);
      await workflow.execute({
        provider,
        variables: {}, // no $previous
      });

      expect(action.executeCalls[0].input).toBe("");
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
    it("should pass options to Action context", async () => {
      const provider = createMockProvider([]);
      const action = new TestAction();

      const workflow = serialWorkflow(action);
      await workflow.execute({
        provider,
        variables: {},
        options: { dryRun: true },
      });

      expect(action.executeCalls[0].options).toEqual({ dryRun: true });
    });

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
