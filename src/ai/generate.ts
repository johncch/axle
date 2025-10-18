import { AxleMessage } from "../messages/types.js";
import { Recorder } from "../recorder/recorder.js";
import { ToolDef } from "../tools/types.js";
import { AIProvider, AIResponse } from "./types.js";

interface GenerateProps {
  provider: AIProvider;
  messages: Array<AxleMessage>;
  tools?: Array<ToolDef>;
  recorder?: Recorder;
}

export async function generate(props: GenerateProps): Promise<AIResponse> {
  const { provider, messages, tools, recorder } = props;
  return provider.createGenerationRequest({
    messages,
    tools,
    context: { recorder },
  });
}
