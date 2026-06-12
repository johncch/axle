import { AxleMessage } from "../messages/message.js";
import type { Span } from "../observability/types.js";
import type { ToolDefinition } from "../tools/types.js";
import type { FileResolver } from "../utils/file.js";
import { AIProvider, AxleModelRequestOptions, ModelResult, ResolvedProviderTool } from "./types.js";

interface GenerateTurnParams extends AxleModelRequestOptions {
  provider: AIProvider;
  model: string;
  messages: Array<AxleMessage>;
  system?: string;
  tools?: Array<ToolDefinition>;
  providerTools?: Array<ResolvedProviderTool>;
  span?: Span;
  fileResolver?: FileResolver;
}

export async function generateTurn(props: GenerateTurnParams): Promise<ModelResult> {
  const {
    provider,
    model,
    messages,
    system,
    tools,
    providerTools,
    span,
    fileResolver,
    ...requestOptions
  } = props;
  return provider.createGenerationRequest(model, {
    messages,
    system,
    tools,
    providerTools,
    runtime: { span, fileResolver },
    ...requestOptions,
  });
}
