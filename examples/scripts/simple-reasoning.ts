import { Agent, Instruct } from "../../src/index.js";
import { useCLIHelper } from "./helper.js";

const [provider, model] = useCLIHelper();

async function reasonIt() {
  const agent = new Agent({ provider, model, reasoning: true });

  agent.on((event) => {
    if (event.type === "part:start" && event.part.type === "thinking") {
      process.stdout.write("--- thinking ---\n");
    }
    if (event.type === "thinking:delta") {
      process.stdout.write(event.delta);
    }
    if (event.type === "part:start" && event.part.type === "text") {
      process.stdout.write("\n\n--- response ---\n");
    }
    if (event.type === "text:delta") {
      process.stdout.write(event.delta);
    }
  });

  const instruct = new Instruct(
    "If x + y = 10 and xy = 21, what are x and y? Show your reasoning step by step.",
  );

  await agent.send(instruct).final;
  process.stdout.write("\n");
}

reasonIt();
