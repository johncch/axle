import type {
  AxleAssistantMessage,
  AxleUserMessage,
  MessageMetadata,
} from "../messages/message.js";
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

export interface CompileUserTurnOptions {
  metadata?: MessageMetadata;
}

export function compileUserTurn(
  message: string,
  options?: CompileUserTurnOptions,
): CompiledUserTurn<string>;
export function compileUserTurn<TSchema extends OutputSchema | undefined>(
  instruct: Instruct<TSchema>,
  options?: CompileUserTurnOptions,
): CompiledUserTurn<InstructResponse<TSchema>>;
export function compileUserTurn(
  messageOrInstruct: string | Instruct<any>,
  options?: CompileUserTurnOptions,
): CompiledUserTurn<any>;
export function compileUserTurn(
  messageOrInstruct: string | Instruct<any>,
  options: CompileUserTurnOptions = {},
): CompiledUserTurn<any> {
  if (typeof messageOrInstruct === "string") {
    return {
      message: {
        role: "user",
        id: crypto.randomUUID(),
        content: [{ type: "text", text: messageOrInstruct }],
        ...(options.metadata ? { metadata: options.metadata } : {}),
      },
      parse: (final) => parseAssistantResponse(final, undefined),
    };
  }

  const text = messageOrInstruct.render();
  const files = messageOrInstruct.files;
  const schema = messageOrInstruct.schema;
  const metadata = options.metadata ?? messageOrInstruct.metadata;

  return {
    message: {
      role: "user",
      id: crypto.randomUUID(),
      content: toContentParts({ text, files }),
      ...(metadata ? { metadata } : {}),
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
