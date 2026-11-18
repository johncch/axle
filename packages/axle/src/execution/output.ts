import type { JsonSchema } from "../core/parse.js";
import type { AxleMessage, AxleUserMessage } from "../messages/message.js";
import type { AIProvider } from "../protocols/types.js";

/** How a schema reached the model: on the provider request, or as prompt text. */
export type OutputMode = "native" | "prompt";

export interface RequestOutput {
  schema: JsonSchema;
  mode: OutputMode;
}

/**
 * The schema the last user message asks for and the path this provider
 * takes it by, or `undefined` when that message carries none. See
 * docs/architecture/structured-output.md.
 */
export function requestOutput(
  provider: AIProvider,
  messages: ReadonlyArray<AxleMessage>,
): RequestOutput | undefined {
  const last = messages.findLast((message) => message.role === "user");
  if (!last?.output) return undefined;
  return { schema: last.output.schema, mode: provider.structuredOutput ? "native" : "prompt" };
}

export function outputInstructions(schema: JsonSchema): string {
  return (
    "# Output Format Instructions\n\nReturn only valid JSON matching this JSON Schema. Do not wrap it in markdown. Do not include prose before or after the JSON.\n\n" +
    `${JSON.stringify(schema, null, 2)}\n\n`
  );
}

/** A copy of the messages with each user message's schema written ahead of its text. */
export function withOutputInstructions(messages: ReadonlyArray<AxleMessage>): AxleMessage[] {
  return messages.map((message) =>
    message.role === "user" && message.output ? instructed(message) : message,
  );
}

function instructed(message: AxleUserMessage): AxleUserMessage {
  const instructions = outputInstructions(message.output!.schema);
  if (typeof message.content === "string") {
    return { ...message, content: instructions + message.content };
  }
  const index = message.content.findIndex((part) => part.type === "text");
  if (index === -1) {
    return { ...message, content: [{ type: "text", text: instructions }, ...message.content] };
  }
  const content = message.content.map((part, i) =>
    i === index && part.type === "text" ? { ...part, text: instructions + part.text } : part,
  );
  return { ...message, content };
}
