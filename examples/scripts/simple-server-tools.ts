import { Agent } from "../../src/index.js";
import type { ServerTool } from "../../src/tools/types.js";
import { useCLIHelper } from "./helper.js";

const [provider, model] = useCLIHelper();

const webSearch: ServerTool = { type: "server", name: "web_search" };

const agent = new Agent({ provider, model, tools: [webSearch] });

agent.on((event) => {
  switch (event.type) {
    case "text:start":
      console.log(`\n[Text] ${event.index} started`);
      break;
    case "text:delta":
      process.stdout.write(event.delta);
      break;
    case "internal-tool:start":
      console.log(`\n[Server Tool] ${event.name} started`);
      break;
    case "internal-tool:complete":
      console.log(`[Server Tool] ${event.name} complete`);
      break;
    case "error":
      console.error(`[Error] ${JSON.stringify(event.error, null, 2)}`);
      break;
  }
});

console.log("[Starting...]");

try {
  const result = await agent.send("What are today's top news headlines?").final;
  console.log(`\n[Usage] in: ${result.usage.in}, out: ${result.usage.out}`);
} catch (e) {
  console.error(e);
}

console.log("[Complete]");
