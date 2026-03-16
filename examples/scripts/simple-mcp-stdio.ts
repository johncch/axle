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
    case "part:start":
      if (event.part.type === "text") {
        console.log(`[Start] text`);
      } else if (event.part.type === "thinking") {
        console.log(`[Start] thinking`);
      } else if (event.part.type === "action") {
        console.log(`[Tool] Starting ${event.part.detail.name} tool`);
      }
      break;
    case "thinking:delta":
    case "text:delta":
      process.stdout.write(`${event.delta}`);
      break;
    case "part:end":
      console.log(`\n[End] part ${event.partId}`);
      break;
    case "action:running":
      console.log(`[Tool] Running tool ${event.partId}`);
      break;
    case "action:complete":
      console.log(`[Tool] Tool complete ${JSON.stringify(event.result)}`);
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
