import { generate, Instruct, type OutputSchema } from "@fifthrevision/axle";
import * as z from "zod";
import { fail } from "./helpers.js";
import type { CheckCase, CheckCaseContext, CheckCaseResult } from "./types.js";

interface SchemaProbe<TSchema extends OutputSchema = OutputSchema> {
  id: string;
  description: string;
  prompt: string;
  schema: TSchema;
  check?(response: z.infer<TSchema>): string[];
}

const schemaProbes: SchemaProbe[] = [
  defineProbe({
    id: "primitive-arrays",
    description: "Instruct schema with arrays of strings and numbers.",
    prompt:
      "List exactly three benefits of structured output and assign each a usefulness score from 0 to 1.",
    schema: z.object({
      bullets: z.array(z.string()),
      scores: z.array(z.number()),
    }),
    check: (response) => [
      ...(response.bullets.length === 3
        ? []
        : [`Expected 3 bullets, got ${response.bullets.length}.`]),
      ...(response.scores.length === 3
        ? []
        : [`Expected 3 scores, got ${response.scores.length}.`]),
    ],
  }),
  defineProbe({
    id: "nested-object",
    description: "Instruct schema with a nested object containing an array.",
    prompt:
      "Create a compact profile for Ada Lovelace. Include her name, an approximate age as a number, and three skills.",
    schema: z.object({
      person: z.object({
        name: z.string(),
        age: z.number(),
        skills: z.array(z.string()),
      }),
    }),
    check: (response) =>
      response.person.skills.length === 3
        ? []
        : [`Expected 3 skills, got ${response.person.skills.length}.`],
  }),
  defineProbe({
    id: "array-of-objects",
    description: "Instruct schema with an array of objects with mixed primitive fields.",
    prompt:
      "Create exactly three implementation tasks for adding a caching layer to a web service.",
    schema: z.object({
      tasks: z.array(
        z.object({
          title: z.string(),
          priority: z.string(),
          done: z.boolean(),
        }),
      ),
    }),
    check: (response) =>
      response.tasks.length === 3 ? [] : [`Expected 3 tasks, got ${response.tasks.length}.`],
  }),
  defineProbe({
    id: "optional-field",
    description: "Instruct schema with an optional field the model may omit.",
    prompt:
      "Write a release note title for a caching layer feature. Include notes only if they add useful detail.",
    schema: z.object({
      title: z.string(),
      notes: z.string().optional(),
    }),
  }),
  defineProbe({
    id: "hostile-string",
    description:
      "Instruct string field containing quotes, braces, a code fence, and XML-like text.",
    prompt:
      'Return a code-oriented string containing quotes, braces, a markdown code fence, and the literal text "<tag>value</tag>".',
    schema: z.object({
      content: z.string(),
    }),
    check: (response) =>
      response.content.includes("<tag>value</tag>")
        ? []
        : ["Content string lost the literal <tag>value</tag> text."],
  }),
  defineProbe({
    id: "prose-prone",
    description: "Instruct prompt that tempts the model to wrap the structured answer in prose.",
    prompt:
      "Answer conversationally but still satisfy the required structured output. Should a web service cache at the edge or at the origin?",
    schema: z.object({
      decision: z.string(),
      rationale: z.string(),
    }),
  }),
];

// The array element type erases the schema generic; building each probe
// through this function keeps `check` typed against its own schema.
function defineProbe<TSchema extends OutputSchema>(probe: SchemaProbe<TSchema>): SchemaProbe {
  return probe as unknown as SchemaProbe;
}

export const instructJsonCases: CheckCase[] = schemaProbes.map((probe) => ({
  id: `instruct-json-${probe.id}`,
  description: probe.description,
  group: "extended",
  run: (context) => runSchemaProbe(probe, context),
}));

async function runSchemaProbe(
  probe: SchemaProbe,
  { provider, model, requestOptions }: CheckCaseContext,
): Promise<CheckCaseResult> {
  const result = await generate({
    provider,
    model,
    ...requestOptions,
    instruct: new Instruct({ prompt: probe.prompt, schema: probe.schema }),
  });

  if (!result.ok) {
    return fail({ error: result.error, rawText: getRawText(result.final?.content) });
  }

  const failureReasons = probe.check?.(result.response) ?? [];
  return {
    ok: failureReasons.length === 0,
    ...(failureReasons.length > 0 ? { failureReasons } : {}),
    details: { response: result.response, usage: result.usage },
  };
}

function getRawText(content: unknown): string | undefined {
  if (!Array.isArray(content)) return undefined;
  return content
    .filter((part): part is { type: "text"; text: string } => part?.type === "text")
    .map((part) => part.text)
    .join("");
}
