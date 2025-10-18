import { config } from "dotenv";
import { z } from "zod";
import { AIProvider, GenerationResult } from "../../src/ai/types.js";
import { generate } from "../../src/index.js";
import { getAllAxles } from "./helper.js";
config();

const axles = getAllAxles();

const callNameTool = {
  name: "setName",
  description: "Set your name in the app",
  schema: z.object({
    name: z.string().describe("The name to call yourself"),
  }),
};

for (const axle of axles) {
  const result = await generate({
    provider: axle.provider,
    messages: [
      {
        role: "user",
        content: "Please say hello and then call the setName function with your name",
      },
    ],
    tools: [callNameTool],
  });

  printResults(axle.provider, result);
}

function printResults(provider: AIProvider, result: GenerationResult) {
  console.log(`\n[RUN] ${provider.name} (${provider.model})`);
  console.log("=".repeat(50));
  console.log(`${spacer("Result")}: ${result.type}`);
  if (result.type === "success") {
    console.log(`${spacer("Text")}: ${result.text}`);

    if (result.toolCalls) {
      for (const toolCall of result.toolCalls) {
        console.log(`${spacer("ToolCall")}: ${toolCall.id}`);
        console.log(`${spacer("Name", { indent: 2 })}: ${toolCall.name}`);
        console.log(`${spacer("Arguments", { indent: 2 })}: ${stringify(toolCall.arguments)}`);
      }
    }
  } else {
    console.log(result.error.message);
  }
}

function stringify(input: any) {
  if (typeof input === "string") {
    return input;
  }
  return JSON.stringify(input);
}

function spacer(text: string, options: { length?: number; indent?: number } = {}) {
  const { length = 12, indent = 0 } = options;
  const indentation = " ".repeat(indent);
  const paddedText = text.padEnd(length - indent, " ");
  return indentation + paddedText;
}
