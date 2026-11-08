import type { DeferredTool } from "@fifthrevision/axle/ui";
import z from "zod";

export const askUser = {
  type: "deferred",
  name: "ask_user",
  description: "Ask the person a question and wait for their answer",
  schema: z.object({ question: z.string() }),
} satisfies DeferredTool;
