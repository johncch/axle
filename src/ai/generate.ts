import { AxleMessage } from "../messages/types.js";
import { Recorder } from "../recorder/recorder.js";
import { ToolDefinition } from "../tools/types.js";
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
  recorder?: Recorder;
  options?: GenerateOptions;
}

export async function generate(props: GenerateProps): Promise<ModelResult> {
  const { provider, messages, system, tools, recorder, options } = props;
  return provider.createGenerationRequest({
    messages,
    system,
    tools,
    context: { recorder },
    options,
  });
}
