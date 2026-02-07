import { config } from "dotenv";
import { z } from "zod";
import { generateTurn } from "../../src/index.js";
import { AIProvider, ModelResult } from "../../src/providers/types.js";
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
  let options: any = {};
  if (axle.provider.name === "OpenAI") {
    options.reasoning = {
      summary: "detailed",
    };
  }

  const result = await generateTurn({
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

function printResults(provider: AIProvider, result: ModelResult) {
  console.log(`\n[RUN] ${provider.name} (${provider.model})`);
  console.log("=".repeat(50));
  console.log(`${spacer("Result")}: ${result.type}`);
  if (result.type === "success") {
    console.log(`${spacer("Text")}: ${result.text}`);

    let toolIndex = 0;
    console.log(`${spacer(`Content Parts`)}: `);
    for (const part of result.content) {
      if (part.type === "text" || part.type === "thinking") {
        console.log(`${spacer(part.type)}: ${part.text}`);
      } else {
        toolIndex += 1;
        console.log(`${spacer(`Tool Call ${toolIndex}`)}: ${part.id}`);
        console.log(`${spacer("Name", { indent: 2 })}: ${part.name}`);
        console.log(`${spacer("Arguments", { indent: 2 })}: ${stringify(part.parameters)}`);
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
