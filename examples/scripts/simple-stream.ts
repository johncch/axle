import z from "zod";
import { SimpleWriter, stream, Tracer } from "../../src/index.js";
import { useCLIHelper } from "./helper.js";

const [provider, model] = useCLIHelper();

const callNameTool = {
  name: "setName",
  description: "Set your name in the app",
  schema: z.object({
    name: z.string().describe("The name to call yourself"),
  }),
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
  const result = stream({
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
    onToolCall: async (name, parameters) => {
      console.log(`[Tool] Calling ${name} with parameters ${JSON.stringify(parameters)}`);
      return {
        type: "success",
        content: "success",
      };
    },
    tracer: tracer.startSpan("stream"),
  });
  result.onPartStart((index, type) => {
    console.log(`[Start] ${index} ${type}`);
  });

  result.onPartUpdate((index, type, delta, acc) => {
    process.stdout.write(`${delta}`);
  });

  result.onPartEnd((index, type, final) => {
    console.log(`\n[End] ${index} ${type}`);
  });

  result.onError((error) => {
    console.error(`[Error] ${JSON.stringify(error, null, 2)}`);
  });

  const final = await result.final;
  console.log(JSON.stringify(final, null, 2));
} catch (e) {
  console.error(e);
}

console.log("[Complete]");
