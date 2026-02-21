// Core
export { Agent } from "./core/Agent.js";
export type { AgentConfig, AgentHandle, AgentResult } from "./core/Agent.js";
export { compileInstruct } from "./core/compile.js";
export { Instruct } from "./core/index.js";
export { parseResponse } from "./core/parse.js";

// AI Providers
export { Anthropic, anthropic } from "./providers/anthropic/index.js";
export { chatCompletions } from "./providers/chatcompletions/index.js";
export { Gemini, gemini } from "./providers/gemini/index.js";
export { generate, generateTurn, stream } from "./providers/index.js";
export { OpenAI, openai } from "./providers/openai/index.js";
export type { StreamEvent, StreamEventCallback } from "./providers/stream.js";
export { AxleStopReason } from "./providers/types.js";
export type { AIProvider } from "./providers/types.js";

// Tools
export { braveSearchTool, calculatorTool } from "./tools/index.js";
export type { AxleTool, ExecutableTool, ServerTool, ToolDefinition } from "./tools/types.js";

// MCP
export { MCP } from "./mcp/index.js";
export type { MCPConfig, MCPHttpConfig, MCPStdioConfig } from "./mcp/index.js";

// Messages
export { History } from "./messages/history.js";
export type {
  AxleAssistantMessage,
  AxleMessage,
  AxleToolCallMessage,
  AxleToolCallResult,
  AxleUserMessage,
  ContentPart,
  ContentPartFile,
  ContentPartText,
  ContentPartThinking,
  ContentPartToolCall,
  ToolResultPart,
} from "./messages/message.js";

// Tracer
export { SimpleWriter, Tracer } from "./tracer/index.js";
export type {
  EventLevel,
  SimpleWriterOptions,
  SpanData,
  SpanOptions,
  SpanType,
  TraceWriter,
  TracingContext,
} from "./tracer/index.js";

// Memory
export { ProceduralMemory } from "./memory/index.js";
export type {
  AgentMemory,
  MemoryContext,
  ProceduralMemoryConfig,
  RecallResult,
} from "./memory/index.js";

// Store
export { LocalFileStore } from "./store/index.js";
export type { FileStore } from "./store/index.js";

// Utils
export { loadFileContent } from "./utils/file.js";
export type { FileInfo } from "./utils/file.js";
