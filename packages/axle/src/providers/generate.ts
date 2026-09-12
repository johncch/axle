import type { OutputSchema } from "../core/parse.js";
import type { GenerateResult } from "./helpers.js";
import {
  stream,
  type StreamInstructParams,
  type StreamInstructResult,
  type StreamParams,
} from "./stream.js";

export type GenerateParams = StreamParams;

export type GenerateInstructParams<TSchema extends OutputSchema | undefined> =
  StreamInstructParams<TSchema>;
export type GenerateInstructResult<TSchema extends OutputSchema | undefined> =
  StreamInstructResult<TSchema>;

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
  return stream(options).final;
}
