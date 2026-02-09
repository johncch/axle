import { config } from "dotenv";
import { z } from "zod";
import { streamTurn } from "../../src/index.js";
import { useCLIHelper } from "./helper.js";
config();

function setupAndStream() {
  const [provider, model] = useCLIHelper();

  const callNameTool = {
    name: "setName",
    description: "Set your name in the app",
    schema: z.object({
      name: z.string().describe("The name to call yourself"),
    }),
  };

  let options: any = {};
  // if (provider.name === "OpenAI") {
  //   options.reasoning = {
  //     summary: "detailed",
  //   };
  // }

  return streamTurn({
    provider: provider,
    model,
    messages: [
      {
        role: "user",
        content:
          "Can you tell me a 3 sentence story with a character's name and then call the setName function with the name",
      },
    ],
    tools: [callNameTool],
    options,
  });
}

async function test1() {
  const result = setupAndStream();
  let index = 0;

  const monitor = setInterval(() => {
    const current = result.current; // Synchronous snapshot
    index += 1;
    console.log(`[${index}] Streamed so far: ${JSON.stringify(current.content)}`);
  }, 500);

  // Get final result
  const final = await result.final;
  clearInterval(monitor);
  console.log(`Complete: ${JSON.stringify(final)}`);
}

async function test2() {
  const result = setupAndStream();
  for await (const chunk of result) {
    console.log(JSON.stringify(chunk));
  }
}

// await test1();
await test2();

// const result1 = stream({ provider, messages, tools });

// result1.onText((text) => console.log(text)).onComplete((data) => console.log("Done!", data));

// // Example 2: Async iterator consumption
// const result2 = stream({ provider, messages, tools });

// for await (const chunk of result2.chunks()) {
//   switch (chunk.type) {
//     case "text":
//       console.log("Text:", chunk.data.text);
//       break;
//     case "tool-call-start":
//       console.log("Tool call:", chunk.data.name);
//       break;
//     case "complete":
//       console.log("Stream complete");
//       break;
//   }
// }

// Example 3: Message building consumption
// const result3 = stream({ provider, messages, tools });

// Get partial message as it builds
// setInterval(() => {
//   const partial = result3.getCurrentMessage();
//   console.log("Current message:", partial);
// }, 100);

// Get final complete message
// const finalMessage = await result3.message;
// console.log("Final:", finalMessage);

// // Example 4: Mixed consumption patterns
// const result4 = stream({ provider, messages, tools });

// // Use events for real-time updates
// result4.onText((text) => updateUI(text));

// // Use message building for final result
// const message = await result4.messages();
// saveToDatabase(message);

// // Example 5: Raw chunk access for debugging
// const result5 = stream({ provider, messages, tools });
// result5.onComplete(() => {
//   const chunks = result5.getRawChunks();
//   console.log("All chunks:", chunks);
// });

// // Example 6: Custom processing
// const result6 = stream({ provider, messages, tools });

// result6.onChunk((chunk) => {
//   // Custom logic for any chunk type
//   if (chunk.type === "thinking-start") {
//     showThinkingUI();
//   }
// });
