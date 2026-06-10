import type { z, ZodObject } from "zod";
import { Agent, type MaybePromise } from "../core/agent/index.js";
import type { AxleModelRequestOptions } from "../providers/types.js";
import type { Stats } from "../types.js";
import type { ExecutableTool, ToolContext } from "./types.js";

export interface AgentToolResult {
  response: unknown;
  usage: Stats;
}

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
  /** Return structured JSON with usage instead of only the child response. */
  includeUsage?: boolean;
}

/**
 * Expose an Agent as a normal executable tool.
 *
 * This lets a parent model delegate bounded work to a child agent while only
 * receiving the child agent's final response.
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
      } finally {
        unsubscribe();
      }

      if (!result.ok) {
        return JSON.stringify({ error: result.error, usage: result.usage });
      }

      const response = result.response;
      if (options.includeUsage) {
        return JSON.stringify({
          response,
          usage: result.usage,
        } satisfies AgentToolResult);
      }

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
