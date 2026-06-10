import type { z, ZodObject } from "zod";
import type { Agent, MaybePromise } from "../core/agent/index.js";
import { AxleAbortError } from "../errors/AxleAbortError.js";
import { AxleToolFatalError } from "../errors/AxleToolFatalError.js";
import type { AxleModelRequestOptions } from "../providers/types.js";
import type { ExecutableTool, ToolContext } from "./types.js";

export interface CreateAgentToolOptions<TSchema extends ZodObject<any>> {
  name: string;
  description: string;
  schema: TSchema;
  /** Create the child agent for this tool call. Fresh agents are recommended. */
  createAgent: (input: z.infer<TSchema>, ctx: ToolContext) => MaybePromise<Agent>;
  /**
   * Convert tool input into the child-agent user prompt. Defaults to a compact
   * JSON task payload.
   */
  prompt?: string | ((input: z.infer<TSchema>) => string);
  /** Per-send request overrides for the child agent. */
  request?: AxleModelRequestOptions;
}

/**
 * Expose an Agent as a normal executable tool.
 *
 * This lets a parent model delegate bounded work to a child agent while only
 * receiving the child agent's final response. The child's turn events are
 * forwarded through `ctx.emit` and its token usage through `ctx.reportUsage`,
 * so parents can render live progress and reconstruct cost.
 *
 * @experimental Shapes related to subagent rendering may change in a minor
 * release.
 */
export function createAgentTool<TSchema extends ZodObject<any>>(
  options: CreateAgentToolOptions<TSchema>,
): ExecutableTool<TSchema> {
  return {
    kind: "agent",
    name: options.name,
    description: options.description,
    schema: options.schema,
    async execute(input, ctx) {
      const agent = await options.createAgent(input, ctx);
      const prompt = resolvePrompt(options.prompt, input);
      const unsubscribe = agent.on((event) => ctx.emit({ type: "turn-event", event }));
      let result;
      try {
        result = await agent.send(prompt, {
          ...options.request,
          signal: ctx.signal,
        }).final;
      } catch (error) {
        throw stripChildConversation(error, options.name);
      } finally {
        unsubscribe();
      }

      if (result.usage) ctx.reportUsage?.(result.usage);
      if (!result.ok) {
        throw new Error(`Subagent failed: ${JSON.stringify(result.error)}`);
      }
      const response = result.response;
      return typeof response === "string" ? response : JSON.stringify(response);
    },
  };
}

function resolvePrompt<TSchema extends ZodObject<any>>(
  prompt: CreateAgentToolOptions<TSchema>["prompt"],
  input: z.infer<TSchema>,
): string {
  if (typeof prompt === "function") return prompt(input);
  if (typeof prompt === "string") return prompt;
  return `Complete this delegated task. Input: ${JSON.stringify(input)}`;
}

// Terminal errors from the child carry the child conversation's
// messages/partial; strip them so the parent never adopts another
// conversation's history. Usage is kept for cost accounting.
function stripChildConversation(error: unknown, toolName: string): unknown {
  if (error instanceof AxleToolFatalError) {
    return new AxleToolFatalError(error.message, {
      toolName,
      usage: error.usage,
      cause: error,
    });
  }
  if (error instanceof AxleAbortError) {
    return new AxleAbortError(error.message, {
      reason: error.reason,
      usage: error.usage,
    });
  }
  return error;
}
