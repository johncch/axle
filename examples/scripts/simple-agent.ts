import z from "zod";
import { Agent, Instruct } from "../../src/index.js";
import type { Tool } from "../../src/tools/types.js";
import { useCLIHelper } from "./helper.js";

const [provider, model] = useCLIHelper();

const setNameTool: Tool = {
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
instruct.addTool(setNameTool);

const agent = new Agent(instruct, { provider, model });

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
  const result = await agent.start().final;
  console.log(`\n[Response] ${result.response}`);
  console.log(`[Usage] in: ${result.usage.in}, out: ${result.usage.out}`);

  // Follow-up turn — same callbacks, no re-wiring
  const result2 = await agent.send("What was the character's name again?").final;
  console.log(`\n[Response 2] ${result2.response}`);
} catch (e) {
  console.error(e);
}

console.log("[Complete]");
