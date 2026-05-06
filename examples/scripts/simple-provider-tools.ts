import { Agent } from "../../src/index.js";
import type { ProviderTool } from "../../src/tools/types.js";
import { useCLIHelper } from "./helper.js";

const [provider, model] = useCLIHelper();

const webSearch: ProviderTool = { type: "provider", name: "web_search" };

const agent = new Agent({ provider, model, providerTools: [webSearch] });

agent.on((event) => {
  switch (event.type) {
    case "part:start":
      if (event.part.type === "text") {
        console.log(`\n[Text] started`);
      } else if (event.part.type === "action" && event.part.kind === "provider-tool") {
        console.log(`\n[Provider Tool] ${event.part.detail.name} started`);
      }
      break;
    case "text:delta":
      process.stdout.write(event.delta);
      break;
    case "action:complete":
      console.log(`[Provider Tool] complete ${JSON.stringify(event.result)}`);
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
