import type { AxleAssistantMessage, AxleUserMessage } from "../messages/message.js";
import { getTextContent, toContentParts } from "../messages/utils.js";
import { Instruct } from "./Instruct.js";
import type { OutputSchema, ParsedSchema } from "./parse.js";
import { parseResponse } from "./parse.js";

export type InstructResponse<TSchema extends OutputSchema | undefined> =
  TSchema extends OutputSchema ? ParsedSchema<TSchema> : string;

export interface CompiledUserTurn<TResponse = string> {
  message: AxleUserMessage;
  parse(final: AxleAssistantMessage | undefined): TResponse | null;
}

export function compileUserTurn(message: string): CompiledUserTurn<string>;
export function compileUserTurn<TSchema extends OutputSchema | undefined>(
  instruct: Instruct<TSchema>,
): CompiledUserTurn<InstructResponse<TSchema>>;
export function compileUserTurn(messageOrInstruct: string | Instruct<any>): CompiledUserTurn<any>;
export function compileUserTurn(messageOrInstruct: string | Instruct<any>): CompiledUserTurn<any> {
  if (typeof messageOrInstruct === "string") {
    return {
      message: {
        role: "user",
        id: crypto.randomUUID(),
        content: [{ type: "text", text: messageOrInstruct }],
      },
      parse: (final) => parseAssistantResponse(final, undefined),
    };
  }

  const text = messageOrInstruct.render();
  const files = messageOrInstruct.files;
  const schema = messageOrInstruct.schema;

  return {
    message: {
      role: "user",
      id: crypto.randomUUID(),
      content: toContentParts({ text, files }),
    },
    parse: (final) => parseAssistantResponse(final, schema),
  };
}

export function parseAssistantResponse<TSchema extends OutputSchema | undefined>(
  final: AxleAssistantMessage | undefined,
  schema: TSchema,
): InstructResponse<TSchema> | null {
  if (!final) return null;
  const textContent = getTextContent(final.content);
  return parseResponse(textContent, schema) as InstructResponse<TSchema>;
}
