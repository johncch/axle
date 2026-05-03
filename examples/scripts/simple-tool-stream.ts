import { z } from "zod";
import { Agent } from "../../src/index.js";
import type { ExecutableTool } from "../../src/tools/types.js";
import { useCLIHelper } from "./helper.js";

const [provider, model] = useCLIHelper();

/**
 * A tool that simulates a long-running task by streaming progress chunks
 * through `ctx.emit`. Each call to ctx.emit() produces a `tool:exec-delta`
 * stream event and an `action:progress` agent event downstream.
 */
const longTaskTool: ExecutableTool<z.ZodObject<{ steps: z.ZodNumber }>> = {
  name: "long_task",
  description:
    "Run a multi-step task. Reports progress chunks as it goes. " +
    "Returns a summary string once finished.",
  schema: z.object({
    steps: z.number().int().min(1).max(10).describe("How many steps to run"),
  }),
  async execute({ steps }, ctx) {
    for (let i = 1; i <= steps; i++) {
      if (ctx.signal.aborted) throw new Error("aborted");
      await new Promise((r) => setTimeout(r, 250));
      ctx.emit(`step ${i}/${steps} done\n`);
    }
    return `completed ${steps} steps`;
  },
};

const agent = new Agent({
  provider,
  model,
  tools: [longTaskTool],
  system:
    "When the user asks you to do something, call the long_task tool with " +
    "an appropriate number of steps, then briefly summarize the result.",
});

agent.on((event) => {
  switch (event.type) {
    case "action:running":
      console.log(`\n[tool] running with ${JSON.stringify(event.parameters)}`);
      break;

    case "action:progress":
      // Live chunk from ctx.emit() — print as it streams in.
      process.stdout.write(`  [progress] ${event.chunk}`);
      break;

    case "action:complete":
      if (event.result.type === "success") {
        console.log(`[tool] complete: ${JSON.stringify(event.result.content)}\n`);
      }
      break;

    case "text:delta":
      process.stdout.write(event.delta);
      break;

    case "error":
      console.error(`\n[error] ${JSON.stringify(event.error, null, 2)}`);
      break;
  }
});

console.log("[Starting...]\n");

try {
  const result = await agent.send("Run a task with 4 steps for me.").final;
  console.log(`\n\n[Usage] in: ${result.usage.in}, out: ${result.usage.out}`);
} catch (e) {
  console.error(e);
}

console.log("[Complete]");
