import { AxleMessage } from "../messages/message.js";
import { ToolDefinition } from "../tools/types.js";
import type { TracingContext } from "../tracer/types.js";
import type { FileResolver } from "../utils/file.js";
import { AIProvider, GenerateTurnOptions, ModelResult } from "./types.js";

export type { GenerateTurnOptions } from "./types.js";

interface GenerateTurnProps {
  provider: AIProvider;
  model: string;
  messages: Array<AxleMessage>;
  system?: string;
  tools?: Array<ToolDefinition>;
  tracer?: TracingContext;
  fileResolver?: FileResolver;
  options?: GenerateTurnOptions;
  reasoning?: boolean;
}

export async function generateTurn(props: GenerateTurnProps): Promise<ModelResult> {
  const { provider, model, messages, system, tools, tracer, fileResolver, options, reasoning } =
    props;
  return provider.createGenerationRequest(model, {
    messages,
    system,
    tools,
    context: { tracer, fileResolver },
    options,
    reasoning,
  });
}
