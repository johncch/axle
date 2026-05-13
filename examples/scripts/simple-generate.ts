import z from "zod";
import { generate, SimpleWriter, Tracer } from "../../src/index.js";
import type { ExecutableTool } from "../../src/tools/types.js";
import { useCLIHelper } from "./helper.js";

const [provider, model] = useCLIHelper();

const callNameTool: ExecutableTool<z.ZodObject<{ name: z.ZodString }>> = {
  name: "setName",
  description: "Set your name in the app",
  schema: z.object({
    name: z.string().describe("The name to call yourself"),
  }),
  async execute() {
    return "success";
  },
};

let options: any = {};
// if (provider.name === "OpenAI") {
//   options.reasoning = {
//     summary: "detailed",
//   };
// }

console.log("[Starting...]");

const tracer = new Tracer();
const logWriter = new SimpleWriter({
  minLevel: options.debug ? "debug" : "info",
  showInternal: options.debug,
  showTimestamp: true,
});
tracer.addWriter(logWriter);

try {
  const result = await generate({
    provider: provider,
    model,
    messages: [
      {
        role: "user",
        content:
          "Can you tell me a 3 sentence story with a character's name and then call the setName function with the name",
      },
    ],
    tools: [callNameTool],
    options,
    onToolCall: async (name, parameters, _ctx) => {
      console.log(`[Tool] Calling ${name} with parameters ${JSON.stringify(parameters)}`);
      return {
        type: "success",
        content: "success",
      };
    },
    tracer: tracer.startSpan("generate"),
  });

  console.log(result.ok ? "success" : "error");
  if (!result.ok) {
    console.log(JSON.stringify(result.error, null, 2));
  } else {
    console.log(JSON.stringify(result.messages, null, 2));
  }
} catch (e) {
  console.error(e);
}

console.log("[Complete]");
