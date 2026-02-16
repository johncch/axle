import { stream } from "../../src/index.js";
import { useCLIHelper } from "./helper.js";

const [provider, model] = useCLIHelper();

console.log("[Starting...]");
console.log("Will cancel the stream after 4 seconds.\n");

const result = stream({
  provider,
  model,
  messages: [
    {
      role: "user",
      content: "Write me a long, detailed essay about the history of the internet.",
    },
  ],
});

result.onPartStart((index, type) => {
  console.log(`[Start] part ${index} (${type})`);
});

result.onPartUpdate((_index, _type, delta) => {
  process.stdout.write(delta);
});

result.onPartEnd((index, type) => {
  console.log(`\n[End] part ${index} (${type})`);
});

// Cancel after 2 seconds
const timer = setTimeout(() => {
  console.log("\n\n--- Calling cancel() ---\n");
  result.cancel();
}, 4000);

const final = await result.final;
clearTimeout(timer);

console.log(`\n[Result: ${final.result}]`);

if (final.result === "cancelled") {
  console.log(`[Messages collected: ${final.messages.length}]`);
  if (final.partial) {
    const textPart = final.partial.content.find((p) => p.type === "text");
    if (textPart && textPart.type === "text") {
      console.log(`[Partial text length: ${textPart.text.length} chars]`);
    }
  } else {
    console.log("[No partial content]");
  }
  console.log(`[Usage: ${final.usage.in} in / ${final.usage.out} out]`);
}

console.log("[Complete]");
