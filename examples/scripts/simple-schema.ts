import * as z from "zod";
import { Agent, Instruct } from "../../src/index.js";
import { useCLIHelper } from "./helper.js";

const [provider, model] = useCLIHelper();

const instruct = new Instruct("Tell me about the planet Mars.", {
  name: z.string(),
  distanceFromSun: z.number(),
  moons: z.array(z.string()),
  habitability: z.string(),
});

const agent = new Agent({ provider, model });
const result = await agent.send(instruct).final;

console.log("Parsed response:", result.response);
console.log(`Usage: in=${result.usage.in}, out=${result.usage.out}`);
