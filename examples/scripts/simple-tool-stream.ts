import { Agent, execTool } from "../../src/index.js";
import { useCLIHelper } from "./helper.js";

const [provider, model] = useCLIHelper();

/**
 * The built-in exec tool streams stdout/stderr as it arrives, surfacing
 * each chunk through `ctx.emit` → `tool:exec-delta` → `action:progress`.
 * Run something visibly slow to see the streaming in action.
 */
const agent = new Agent({
  provider,
  model,
  tools: [execTool],
  system:
    "When the user asks you to do something, call the exec tool with an " +
    "appropriate shell command. After it completes, briefly summarize what happened.",
});

agent.on((event) => {
  switch (event.type) {
    case "action:running":
      console.log(`\n[exec] $ ${(event.parameters as { command?: string })?.command ?? ""}`);
      break;

    case "action:progress":
      // Live stdout/stderr chunks from the running subprocess.
      process.stdout.write(event.chunk);
      break;

    case "action:complete":
      if (event.result.type === "success") {
        console.log(`[exec] complete\n`);
      } else if (event.result.type === "error") {
        console.log(`[exec] error: ${event.result.error.message}\n`);
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
  const result = await agent.send(
    "Run a shell command that prints 'step N' five times with a 0.5 second pause between each.",
  ).final;
  console.log(`\n\n[Usage] in: ${result.usage.in}, out: ${result.usage.out}`);
} catch (e) {
  console.error(e);
}

console.log("[Complete]");
