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

agent.onPartStart((index, type) => {
  console.log(`[Start] ${index} ${type}`);
});

agent.onPartUpdate((index, type, delta) => {
  process.stdout.write(`${delta}`);
});

agent.onPartEnd((index, type) => {
  console.log(`\n[End] ${index} ${type}`);
});

agent.onError((error) => {
  console.error(`[Error] ${JSON.stringify(error, null, 2)}`);
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
