import z from "zod";
import { stream } from "../../src/index.js";
import { getAxle } from "./helper.js";

const axle = getAxle();

const callNameTool = {
  name: "setName",
  description: "Set your name in the app",
  schema: z.object({
    name: z.string().describe("The name to call yourself"),
  }),
};

let options: any = {};
if (axle.provider.name === "OpenAI") {
  options.reasoning = {
    summary: "detailed",
  };
}

const result = stream({
  provider: axle.provider,
  messages: [
    {
      role: "user",
      content: "Can you tell me a 300 word story about AI",
      // "Can you tell me a 300 word story with your name and then call the setName function with your name",
    },
  ],
  tools: [callNameTool],
  options,
  onToolCall: async (name, parameters) => {
    return {
      type: "success",
      content: "success",
    };
  },
});

result.onPartUpdate((index, type, delta, acc) => {
  console.log(`${index} ${type}: ${delta}`);
});

await result.final;
