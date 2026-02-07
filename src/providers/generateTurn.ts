import { AxleMessage } from "../messages/types.js";
import { ToolDefinition } from "../tools/types.js";
import type { TracingContext } from "../tracer/types.js";
import { AIProvider, ModelResult } from "./types.js";

export interface GenerateOptions {
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  stop?: string | string[];
  [key: string]: any; // Allow any additional provider-specific options
}

interface GenerateProps {
  provider: AIProvider;
  messages: Array<AxleMessage>;
  system?: string;
  tools?: Array<ToolDefinition>;
  tracer?: TracingContext;
  options?: GenerateOptions;
}

export async function generateTurn(props: GenerateProps): Promise<ModelResult> {
  const { provider, messages, system, tools, tracer, options } = props;
  return provider.createGenerationRequest({
    messages,
    system,
    tools,
    context: { tracer },
    options,
  });
}
