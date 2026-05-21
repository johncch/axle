/* Request types */

export interface ChatCompletionMessage {
  role: string;
  content: string | ChatCompletionContentPart[] | null;
  tool_calls?: ChatCompletionMessageToolCall[];
  tool_call_id?: string;
}

export interface ChatCompletionContentPart {
  type: "text" | "image_url" | "file";
  text?: string;
  image_url?: { url: string };
  file?: {
    filename?: string;
    file_data: string;
  };
}

export interface ChatCompletionMessageToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface ChatCompletionTool {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: object;
  };
}

/* Response types */

export interface ChatCompletionResponse {
  id: string;
  model: string;
  choices: ChatCompletionChoice[];
  usage?: ChatCompletionUsage;
}

export interface ChatCompletionUsage {
  prompt_tokens: number;
  completion_tokens: number;
  prompt_tokens_details?: ChatCompletionInputTokenDetails;
  input_tokens_details?: ChatCompletionInputTokenDetails;
  completion_tokens_details?: ChatCompletionOutputTokenDetails;
  output_tokens_details?: ChatCompletionOutputTokenDetails;
}

export interface ChatCompletionInputTokenDetails {
  cached_tokens?: number;
  cache_write_tokens?: number;
  cache_creation_tokens?: number;
}

export interface ChatCompletionOutputTokenDetails {
  reasoning_tokens?: number;
}

export interface ChatCompletionChoice {
  index: number;
  message: {
    role: string;
    content: string | null;
    reasoning_content?: string | null;
    tool_calls?: {
      id: string;
      type: "function";
      function: {
        name: string;
        arguments: string;
      };
    }[];
  };
  finish_reason: string;
}

/* Streaming types */

export interface ChatCompletionChunk {
  id: string;
  model: string;
  choices: ChatCompletionChunkChoice[];
  usage?: ChatCompletionUsage;
}

export interface ChatCompletionChunkChoice {
  index: number;
  delta: {
    role?: string;
    content?: string;
    reasoning_content?: string;
    tool_calls?: {
      index: number;
      id?: string;
      function?: {
        name?: string;
        arguments?: string;
      };
    }[];
  };
  finish_reason: string | null;
}
