import { Agent, Instruct } from "@fifthrevision/axle";
import * as z from "zod";
import { useCLIHelper } from "./helpers/cli.js";

const [provider, model] = useCLIHelper();

const instruct = new Instruct({
  prompt: "Tell me about the planet Mars.",
  schema: z.object({
    name: z.string(),
    distanceFromSun: z.number(),
    moons: z.array(z.string()),
    habitability: z.string(),
  }),
});

const agent = new Agent({ provider, model });
const result = await agent.send(instruct).final;

console.log("Parsed response:", result.response);
console.log(`Usage: in=${result.usage.in}, out=${result.usage.out}`);
