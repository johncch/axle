import { config } from "dotenv";
import { z } from "zod";
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

  console.log(`[RUN] ${axle.provider.name}, ${axle.provider.model}`);
  console.log(`Result: ${result.type}`);
  if (result.type === "success") {
    console.log(`Text: ${result.text}`);
  } else {
    console.log(result.error.message);
  }
  console.log("");
}
