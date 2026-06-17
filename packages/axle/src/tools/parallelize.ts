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
  /** Maximum bytes to return from one batch result. Defaults to 20 MiB. */
  maxResultBytes?: number;
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

const DEFAULT_MAX_RESULT_BYTES = 20 * 1024 * 1024;
const encoder = new TextEncoder();

/**
 * Create a batch tool that runs a tool over many input items concurrently.
 *
 * The generated tool preserves result order and reports per-item failures
 * instead of failing the whole batch for ordinary execution errors. Fatal
 * and abort errors are not demoted: they propagate and terminate the run,
 * matching the unbatched tool contract.
 *
 * @experimental The generated tool's result parts (`ParallelToolResult`) may
 * change in a minor release.
 */
export function parallelize<TSchema extends ZodObject<any>>(
  tool: ExecutableTool<TSchema>,
  options: ParallelizeOptions = {},
): ExecutableTool<ZodObject<{ items: z.ZodArray<TSchema> }>> {
  const maxItems = options.maxItems ?? 50;
  const maxConcurrency = Math.max(1, options.maxConcurrency ?? 8);
  const maxResultBytes = Math.max(0, options.maxResultBytes ?? DEFAULT_MAX_RESULT_BYTES);
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

      return formatResults(results, maxResultBytes);
    },
  };
}

function formatResults(results: ParallelToolResult[], maxBytes: number): ToolResultPart[] {
  const parts: ToolResultPart[] = [];
  let remaining = maxBytes;

  for (const result of results) {
    const header = result.ok
      ? { index: result.index, ok: true }
      : { index: result.index, ok: false, error: result.error };
    const headerText = `<<result ${JSON.stringify(header)}>>\n`;
    const headerBytes = byteLength({ type: "text", text: headerText });
    if (headerBytes > remaining) {
      pushTextPart(
        parts,
        formatOmissionMarker({
          result,
          reason: "header",
          attemptedBytes: headerBytes,
          remainingBytes: remaining,
          maxBytes,
        }),
        Number.POSITIVE_INFINITY,
      );
      continue;
    }
    pushTextPart(parts, headerText, remaining);
    remaining -= headerBytes;

    if (!result.ok || result.output == null) continue;
    const outputBytes = outputByteLength(result.output);
    if (outputBytes > remaining) {
      pushTextPart(
        parts,
        formatOmissionMarker({
          result,
          reason: "output",
          attemptedBytes: outputBytes,
          remainingBytes: remaining,
          maxBytes,
        }),
        Number.POSITIVE_INFINITY,
      );
      continue;
    }

    if (typeof result.output === "string") {
      pushTextPart(parts, result.output, remaining);
      remaining -= byteLength(parts[parts.length - 1]);
      continue;
    }

    for (const part of result.output) {
      parts.push(part);
      remaining -= byteLength(part);
    }
  }

  return parts;
}

function pushTextPart(parts: ToolResultPart[], text: string, maxBytes: number): boolean {
  if (encoder.encode(text).length > maxBytes) return false;
  parts.push({ type: "text", text });
  return true;
}

function outputByteLength(output: string | ToolResultPart[]): number {
  if (typeof output === "string") return byteLength({ type: "text", text: output });
  return output.reduce((total, part) => total + byteLength(part), 0);
}

function byteLength(part: ToolResultPart): number {
  if (part.type === "text") return encoder.encode(part.text).length;

  const source = part.file.source;
  switch (source.type) {
    case "text":
      return encoder.encode(source.content).length;
    case "base64":
      return encoder.encode(source.data).length;
    case "url":
      return encoder.encode(source.url).length;
    case "ref":
      return part.file.size ?? encoder.encode(`${part.file.name}:${part.file.mimeType}`).length;
  }
}

function formatOmissionMarker({
  result,
  reason,
  attemptedBytes,
  remainingBytes,
  maxBytes,
}: {
  result: ParallelToolResult;
  reason: "header" | "output";
  attemptedBytes: number;
  remainingBytes: number;
  maxBytes: number;
}): string {
  return (
    `<<result ${result.index} omitted: ${reason} ${formatBytes(attemptedBytes)} exceeds ` +
    `remaining budget ${formatBytes(remainingBytes)} of ${formatBytes(maxBytes)}; ` +
    `input ${stringifyForMarker(result.input)}>>`
  );
}

function formatBytes(bytes: number): string {
  if (bytes === 1) return "1 byte";
  return `${bytes} bytes`;
}

function stringifyForMarker(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
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
