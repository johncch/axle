import { AxleMessage } from "../messages/message.js";
import { ToolDefinition } from "../tools/types.js";
import type { TracingContext } from "../tracer/types.js";
import { AIProvider, ModelResult } from "./types.js";

export interface GenerateTurnOptions {
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  stop?: string | string[];
  [key: string]: any; // Allow any additional provider-specific options
}

interface GenerateTurnProps {
  provider: AIProvider;
  model: string;
  messages: Array<AxleMessage>;
  system?: string;
  tools?: Array<ToolDefinition>;
  tracer?: TracingContext;
  options?: GenerateTurnOptions;
}

export async function generateTurn(props: GenerateTurnProps): Promise<ModelResult> {
  const { provider, model, messages, system, tools, tracer, options } = props;
  return provider.createGenerationRequest(model, {
    messages,
    system,
    tools,
    context: { tracer },
    options,
  });
}
