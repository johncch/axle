import * as z from "zod";
import type { OutputSchema } from "../../src/core/parse.js";

export interface StructuredOutputCase<TSchema extends OutputSchema = OutputSchema> {
  id: string;
  description: string;
  prompt: string;
  schema: TSchema;
}

export const structuredOutputCases: StructuredOutputCase[] = [
  {
    id: "flat-primitives",
    description: "Flat string, number, and boolean fields.",
    prompt:
      "Recommend whether Axle should switch structured output from XML tags to JSON. Keep the answer short.",
    schema: z.object({
      answer: z.string(),
      confidence: z.number(),
      accepted: z.boolean(),
    }),
  },
  {
    id: "primitive-arrays",
    description: "Arrays of strings and numbers.",
    prompt:
      "List exactly three benefits of JSON structured output and assign each a usefulness score from 0 to 1.",
    schema: z.object({
      bullets: z.array(z.string()),
      scores: z.array(z.number()),
    }),
  },
  {
    id: "nested-object",
    description: "A nested object with arrays.",
    prompt:
      "Create a compact profile for Ada Lovelace. Include her name, an approximate age as a number, and three skills.",
    schema: z.object({
      person: z.object({
        name: z.string(),
        age: z.number(),
        skills: z.array(z.string()),
      }),
    }),
  },
  {
    id: "array-of-objects",
    description: "An array of objects with mixed primitive fields.",
    prompt:
      "Create exactly three implementation tasks for switching Instruct output parsing to JSON.",
    schema: z.object({
      tasks: z.array(
        z.object({
          title: z.string(),
          priority: z.string(),
          done: z.boolean(),
        }),
      ),
    }),
  },
  {
    id: "optional-field",
    description: "Optional field present or omitted at model discretion.",
    prompt:
      "Write a release note title for JSON structured output. Include notes only if they add useful detail.",
    schema: z.object({
      title: z.string(),
      notes: z.string().optional(),
    }),
  },
  {
    id: "json-hostile-string",
    description: "String content with quotes, braces, markdown fences, and XML-like text.",
    prompt:
      'Return a code-oriented string containing quotes, braces, a markdown code fence, and the literal text "<tag>value</tag>".',
    schema: z.object({
      content: z.string(),
    }),
  },
  {
    id: "prose-prone",
    description:
      "Instruction that tempts the model to add prose before or after the structured answer.",
    prompt:
      "Answer conversationally but still satisfy the required structured output. Should JSON be the default for nested schemas?",
    schema: z.object({
      decision: z.string(),
      rationale: z.string(),
    }),
  },
];

export type StructuredOutputCaseId = (typeof structuredOutputCases)[number]["id"];
