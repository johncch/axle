import { config } from "dotenv";
import { z } from "zod";
import { Axle } from "../../src/index.js";
config();

const axle = new Axle({
  anthropic: {
    "api-key": process.env.ANTHROPIC_API_KEY,
    // model: options.model,
  },
});

const callNameTool = {
  name: "setName",
  description: "Set your name in the app",
  schema: z.object({
    name: z.string().describe("The name to call yourself"),
  }),
};

// const result = stream({
//   provider: axle.provider,
//   messages: [
//     {
//       role: "user",
//       content: "Please say hello and then call the setName function with your name",
//     },
//   ],
//   tools: [callNameTool],
// });

// result.stream.on("text", (text) => {
//   console.log(`text: ${text}`);
// });
// .on("tool-call", (toolcall) => {})
// .on("object", (object) => {});

// for await (const event of result.test) {
//   console.log(event.type);
//   console.log(event.data);
// }

const provider = axle.provider;
const messages = [
  {
    role: "user" as const,
    content: "Please say hello and then call the setName function with your name",
  },
];
const tools = [callNameTool];

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
