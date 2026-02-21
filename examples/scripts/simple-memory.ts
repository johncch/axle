import { Agent, ProceduralMemory } from "../../src/index.js";
import { useCLIHelper } from "./helper.js";

const [provider, model] = useCLIHelper();

const memory = new ProceduralMemory({
  provider,
  model,
});

const agent = new Agent({
  provider,
  model,
  system: "You are a helpful assistant that summarizes text.",
  name: "summarizer",
  // scope: { user: "demo" },
  memory,
});

agent.on((event) => {
  if (event.type === "text:delta") {
    process.stdout.write(event.delta);
  }
});

try {
  // Turn 1: Ask for a summary
  console.log("[Turn 1] Asking for a summary...\n");
  await agent.send("Summarize the benefits of exercise.").final;

  // Turn 2: Give a correction — this is what memory will extract
  console.log("\n\n[Turn 2] Giving feedback...\n");
  await agent.send("That's too long. Always use bullet points and keep each point to one sentence.")
    .final;

  // Turn 3: New task — on first run this won't benefit from memory yet,
  // but on subsequent runs the recalled instructions will shape the response
  console.log("\n\n[Turn 3] New task...\n");
  await agent.send("Summarize the benefits of reading books.").final;

  console.log("\n");
} catch (e) {
  console.error(e);
}

console.log("[Complete]");
console.log("[Tip] Run this script again to see learned instructions applied from the start.");
console.log("[Tip] Check .axle/memory/procedural/ to see the stored instructions.");
