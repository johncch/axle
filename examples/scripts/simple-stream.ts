import type { ExecutableTool } from "@fifthrevision/axle";
import { SimpleWriter, stream, Tracer } from "@fifthrevision/axle";
import z from "zod";
import { useCLIHelper } from "./helpers/cli.js";

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

console.log("[Starting...]");

const tracer = new Tracer();
const logWriter = new SimpleWriter({
  minLevel: "info",
  showInternal: false,
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
    onToolCall: async (name, parameters, _ctx) => {
      console.log(`[Tool] Calling ${name} with parameters ${JSON.stringify(parameters)}`);
      return {
        type: "success",
        content: "success",
      };
    },
    span: tracer.startSpan("stream"),
  });

  result.on((event) => {
    switch (event.type) {
      case "text:start":
        console.log(`[Start] text`);
        break;
      case "thinking:start":
        console.log(`[Start] thinking`);
        break;
      case "text:delta":
        process.stdout.write(`${event.delta}`);
        break;
      case "text:end":
        console.log(`\n[End] text`);
        break;
      case "thinking:end":
        console.log(`\n[End] thinking`);
        break;
      case "error":
        console.error(`[Error] ${JSON.stringify(event.error, null, 2)}`);
        break;
    }
  });

  const final = await result.final;
  console.log(JSON.stringify(final, null, 2));
} catch (e) {
  console.error(e);
}

console.log("[Complete]");
