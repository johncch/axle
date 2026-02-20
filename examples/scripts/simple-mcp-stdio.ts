import { Agent, Instruct, MCP } from "../../src/index.js";
import { useCLIHelper } from "./helper.js";

const [provider, model] = useCLIHelper();

const wordCountMCP = new MCP({
  transport: "stdio",
  command: "npx",
  args: ["tsx", "examples/mcps/wordcount-server.ts"],
});
await wordCountMCP.connect();

const instruct = new Instruct(
  "Can you tell me a 3 sentence story with a character's name and then tell me the number of words and characters in the story",
);

const agent = new Agent({ provider, model, mcps: [wordCountMCP] });

agent.on((event) => {
  switch (event.type) {
    case "text:start":
      console.log(`[Start] ${event.index} text`);
      break;
    case "thinking:start":
      console.log(`[Start] ${event.index} thinking`);
      break;
    case "thinking:delta":
    case "text:delta":
      process.stdout.write(`${event.delta}`);
      break;
    case "text:end":
      console.log(`\n[End] ${event.index} text`);
      break;
    case "thinking:end":
      console.log(`[End] ${event.index} thinking`);
      break;
    case "tool:start":
      console.log(`[Tool] Starting ${event.name} tool`);
      break;
    case "tool:execute":
      console.log(`[Tool] Running ${event.name} tool`);
      break;
    case "tool:complete":
      console.log(`[Tool] Tool ${event.name} complete`);
      break;
    case "error":
      console.error(`[Error] ${JSON.stringify(event.error, null, 2)}`);
      break;
  }
});

console.log("[Starting...]");

try {
  const result = await agent.send(instruct).final;
  console.log(`\n[Response] ${result.response}`);
  console.log(`[Usage] in: ${result.usage.in}, out: ${result.usage.out}`);
} catch (e) {
  console.error(e);
}

console.log("[Complete]");
await wordCountMCP.close();
