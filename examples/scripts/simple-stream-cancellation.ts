import { AxleAbortError, stream } from "../../src/index.js";
import { useCLIHelper } from "./helper.js";

const [provider, model] = useCLIHelper();

console.log("[Starting...]");
console.log("Will cancel the stream after 4 seconds.\n");

const handle = stream({
  provider,
  model,
  messages: [
    {
      role: "user",
      content: "Write me a long, detailed essay about the history of the internet.",
    },
  ],
});

handle.on((event) => {
  switch (event.type) {
    case "text:start":
      console.log(`[Start] part ${event.index} (text)`);
      break;
    case "thinking:start":
      console.log(`[Start] part ${event.index} (thinking)`);
      break;
    case "text:delta":
    case "thinking:delta":
      process.stdout.write(event.delta);
      break;
    case "text:end":
      console.log(`\n[End] part ${event.index} (text)`);
      break;
    case "thinking:end":
      console.log(`\n[End] part ${event.index} (thinking)`);
      break;
    case "error":
      console.log(`\n[Stream error event] ${JSON.stringify(event.error)}`);
      break;
  }
});

const timer = setTimeout(() => {
  const reason = { type: "demo-timeout", afterMs: 4000 };
  console.log("\n\n--- Calling cancel() ---\n");
  handle.cancel(reason);
}, 4000);

try {
  const final = await handle.final;
  console.log(`\n[Result: ${final.ok ? "success" : "error"}]`);
} catch (error) {
  if (error instanceof AxleAbortError) {
    console.log(`\n[Result: ${error.name}]`);
    console.log(`[Reason: ${JSON.stringify(error.reason)}]`);
    console.log(`[Messages collected: ${error.messages?.length ?? 0}]`);

    if (error.partial) {
      const textPart = error.partial.content.find((p) => p.type === "text");
      if (textPart?.type === "text") {
        console.log(`[Partial text length: ${textPart.text.length} chars]`);
      }
    } else {
      console.log("[No partial content]");
    }

    console.log(`[Usage: ${error.usage?.in ?? 0} in / ${error.usage?.out ?? 0} out]`);
  } else {
    throw error;
  }
} finally {
  clearTimeout(timer);
}

console.log("[Complete]");
