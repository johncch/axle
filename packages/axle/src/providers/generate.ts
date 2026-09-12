import { Instruct, type InstructResponse } from "../core/Instruct.js";
import type { OutputSchema } from "../core/parse.js";
import type { AxleMessage } from "../messages/message.js";
import type { GenerateResult } from "./helpers.js";
import { stream, type StreamParams } from "./stream.js";

export type GenerateParams = StreamParams;

export interface GenerateInstructParams<TSchema extends OutputSchema | undefined> extends Omit<
  GenerateParams,
  "messages"
> {
  messages?: Array<AxleMessage>;
  instruct: Instruct<TSchema>;
}

export type GenerateInstructResult<TSchema extends OutputSchema | undefined> = GenerateResult<
  InstructResponse<TSchema>
>;

/**
 * The non-streaming return shape of `stream()`: the same request, the same
 * tool loop, and the same result, resolved as a promise instead of a handle.
 */
export async function generate<TSchema extends OutputSchema | undefined>(
  options: GenerateInstructParams<TSchema>,
): Promise<GenerateInstructResult<TSchema>>;
export async function generate(options: GenerateParams): Promise<GenerateResult>;
export async function generate(
  options: GenerateParams | GenerateInstructParams<any>,
): Promise<GenerateResult | GenerateInstructResult<any>> {
  if ("instruct" in options) return stream(options).final;
  return stream(options).final;
}
