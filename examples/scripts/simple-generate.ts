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

  console.log(JSON.stringify(result, null, 2));
}
