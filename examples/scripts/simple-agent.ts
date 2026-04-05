import z from "zod";
import { Agent, Instruct } from "../../src/index.js";
import type { ExecutableTool } from "../../src/tools/types.js";
import { useCLIHelper } from "./helper.js";

const [provider, model] = useCLIHelper();

const setNameTool: ExecutableTool = {
  name: "setName",
  description: "Set your name in the app",
  schema: z.object({
    name: z.string().describe("The name to call yourself"),
  }),
  async execute(input) {
    console.log(`[Tool] setName called with: ${JSON.stringify(input)}`);
    return "success";
  },
};

const instruct = new Instruct(
  "Can you tell me a 3 sentence story with a character's name and then call the setName function with the name",
);

const agent = new Agent({ provider, model, tools: [setNameTool] });

agent.on((event) => {
  switch (event.type) {
    case "part:start":
      if (event.part.type === "text") {
        console.log(`[Start] text`);
      } else if (event.part.type === "thinking") {
        console.log(`[Start] thinking`);
      } else if (event.part.type === "action") {
        console.log(`[Tool Request] ${event.part.detail.name}`);
      }
      break;
    case "text:delta":
      process.stdout.write(`${event.delta}`);
      break;
    case "part:end":
      console.log(`\n[End] part ${event.partId}`);
      break;
    case "action:running":
      console.log(`[Tool Execute] ${event.partId}`);
      break;
    case "action:complete":
      console.log(`[Tool Complete] ${JSON.stringify(event.result)}`);
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

  // Follow-up turn — same callbacks, no re-wiring
  const result2 = await agent.send("What was the character's name again?").final;
  console.log(`\n[Response 2] ${result2.response}`);
  console.log(`[Usage] in: ${result2.usage.in}, out: ${result2.usage.out}`);
} catch (e) {
  console.error(e);
}

console.log("[Complete]");
