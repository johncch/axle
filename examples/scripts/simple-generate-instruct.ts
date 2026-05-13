import z from "zod";
import { generate, Instruct } from "../../src/index.js";
import { useCLIHelper } from "./helper.js";

const [provider, model] = useCLIHelper();

const instruct = new Instruct({
  prompt: "Name three planets and return a short note about the list.",
  schema: z.object({
    planets: z.array(z.string()),
    note: z.string(),
  }),
});

console.log("[Starting...]");

try {
  const result = await generate({
    provider,
    model,
    instruct,
  });

  if (!result.ok) {
    console.log(JSON.stringify(result.error, null, 2));
  } else {
    console.log("Parsed response:", result.response);
    console.log(`Usage: in=${result.usage?.in ?? 0}, out=${result.usage?.out ?? 0}`);
  }
} catch (e) {
  console.error(e);
}

console.log("[Complete]");
