import z from "zod";
import { Instruct, stream } from "../../src/index.js";
import type { AxleMessage } from "../../src/messages/message.js";
import { useCLIHelper } from "./helper.js";

const [provider, model] = useCLIHelper();

const messages: AxleMessage[] = [
  {
    role: "user",
    content: "We are comparing TypeScript, Rust, and Python for small backend services.",
  },
  {
    role: "assistant",
    id: "prior-summary",
    content: [
      {
        type: "text",
        text: "TypeScript is familiar for web teams, Rust emphasizes performance and safety, and Python is strong for quick iteration.",
      },
    ],
  },
];

const instruct = new Instruct({
  prompt: "Using the prior context, choose the best default language and explain why.",
  schema: z.object({
    choice: z.string(),
    reason: z.string(),
  }),
});

console.log("[Starting...]");

try {
  const handle = stream({
    provider,
    model,
    messages,
    instruct,
  });

  handle.on((event) => {
    switch (event.type) {
      case "text:delta":
        process.stdout.write(event.delta);
        break;
      case "error":
        console.error(`[Error] ${JSON.stringify(event.error, null, 2)}`);
        break;
    }
  });

  const result = await handle.final;

  console.log();
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
