import { AxleMessage } from "../messages/types.js";
import { Recorder } from "../recorder/recorder.js";
import { ToolDefinition } from "../tools/types.js";
import { AIProvider, ModelResult } from "./types.js";

interface GenerateProps {
  provider: AIProvider;
  messages: Array<AxleMessage>;
  tools?: Array<ToolDefinition>;
  recorder?: Recorder;
}

export async function generate(props: GenerateProps): Promise<ModelResult> {
  const { provider, messages, tools, recorder } = props;
  return provider.createGenerationRequest({
    messages,
    tools,
    context: { recorder },
  });
}
