import { z, type ZodObject } from "zod";
import { AxleAbortError } from "../errors/AxleAbortError.js";
import { AxleToolFatalError } from "../errors/AxleToolFatalError.js";
import type { ToolResultPart } from "../messages/message.js";
import type { ExecutableTool } from "./types.js";

export interface ParallelizeOptions {
  /** Name of the generated batch tool. Defaults to `${tool.name}_batch`. */
  name?: string;
  /** Description of the generated batch tool. */
  description?: string;
  /** Maximum items accepted by the generated tool schema. */
  maxItems?: number;
  /** Maximum inner tool calls to run concurrently. */
  maxConcurrency?: number;
}

export interface ParallelToolResult<TInput = unknown> {
  index: number;
  input: TInput;
  ok: boolean;
  output?: string | ToolResultPart[];
  error?: {
    type: "execution";
    message: string;
  };
}

/**
 * Create a batch tool that runs a tool over many input items concurrently.
 *
 * The generated tool preserves result order and reports per-item failures
 * instead of failing the whole batch for ordinary execution errors. Fatal
 * and abort errors are not demoted: they propagate and terminate the run,
 * matching the unbatched tool contract.
 */
export function parallelize<TSchema extends ZodObject<any>>(
  tool: ExecutableTool<TSchema>,
  options: ParallelizeOptions = {},
): ExecutableTool<ZodObject<{ items: z.ZodArray<TSchema> }>> {
  const maxItems = options.maxItems ?? 50;
  const maxConcurrency = Math.max(1, options.maxConcurrency ?? 8);
  const schema = z.object({
    items: z
      .array(tool.schema)
      .min(1)
      .max(maxItems)
      .describe(`Inputs to run through ${tool.name}. Results are returned in the same order.`),
  });

  return {
    // Inherit presentation kind so child events from agent-backed tools keep
    // rendering as subagent activity when batched.
    ...(tool.kind ? { kind: tool.kind } : {}),
    name: options.name ?? `${tool.name}_batch`,
    description:
      options.description ??
      `Run ${tool.name} for multiple inputs concurrently and return ordered per-item results.`,
    schema,
    async execute(input, ctx) {
      const results = await runWithConcurrency(
        input.items,
        maxConcurrency,
        ctx.signal,
        async (item, index) => {
          try {
            return {
              index,
              input: item,
              ok: true,
              output: await tool.execute(item, ctx),
            } satisfies ParallelToolResult<z.infer<TSchema>>;
          } catch (error) {
            if (error instanceof AxleToolFatalError || error instanceof AxleAbortError) {
              throw error;
            }
            return {
              index,
              input: item,
              ok: false,
              error: {
                type: "execution",
                message: error instanceof Error ? error.message : String(error),
              },
            } satisfies ParallelToolResult<z.infer<TSchema>>;
          }
        },
      );

      return JSON.stringify({ results });
    },
  };
}

async function runWithConcurrency<T, R>(
  items: T[],
  maxConcurrency: number,
  signal: AbortSignal,
  run: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  let stopped = false;
  const workerCount = Math.max(1, Math.min(maxConcurrency, items.length));

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (!stopped && nextIndex < items.length) {
        if (signal.aborted) {
          stopped = true;
          throw new AxleAbortError("Operation aborted", { reason: signal.reason });
        }
        const index = nextIndex++;
        try {
          results[index] = await run(items[index], index);
        } catch (error) {
          stopped = true;
          throw error;
        }
      }
    }),
  );

  return results;
}
