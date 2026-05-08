// Core
export { Agent } from "./core/Agent.js";
export type {
  AgentConfig,
  AgentEventCallback,
  AgentHandle,
  AgentResult,
  SendMessageOptions,
} from "./core/Agent.js";
export { Instruct } from "./core/index.js";
export type { InstructInputs } from "./core/index.js";
export { parseResponse } from "./core/parse.js";
export { AxleAbortError, AxleAgentAbortError, AxleError, TaskError } from "./errors/index.js";

// AI Providers
export { Anthropic, anthropic } from "./providers/anthropic/index.js";
export { chatCompletions } from "./providers/chatcompletions/index.js";
export { Gemini, gemini } from "./providers/gemini/index.js";
export type { StreamResult } from "./providers/helpers.js";
export { generate, generateTurn, stream } from "./providers/index.js";
export { OpenAI, openai } from "./providers/openai/index.js";
export type { StreamEvent, StreamEventCallback, StreamHandle } from "./providers/stream.js";
export { AxleStopReason } from "./providers/types.js";
export type { AIProvider } from "./providers/types.js";

// Tools
export {
  braveSearchTool,
  calculatorTool,
  execTool,
  patchFileTool,
  readFileTool,
  writeFileTool,
} from "./tools/index.js";
export { ToolRegistry } from "./tools/registry.js";
export type { ExecutableTool, ProviderTool, ToolContext, ToolDefinition } from "./tools/types.js";

// MCP
export { MCP } from "./mcp/index.js";
export type { MCPConfig, MCPHttpConfig, MCPStdioConfig } from "./mcp/index.js";

// Messages (internal — kept for advanced/direct stream() users)
export { History } from "./core/history.js";
export type {
  AxleAssistantMessage,
  AxleMessage,
  AxleToolCallMessage,
  AxleToolCallResult,
  AxleUserMessage,
  ContentPart,
  ContentPartFile,
  ContentPartProviderTool,
  ContentPartText,
  ContentPartThinking,
  ContentPartToolCall,
  ToolResultPart,
} from "./messages/message.js";

// Turns (public format)
export { TurnBuilder } from "./turns/builder.js";
export type { AgentEvent } from "./turns/events.js";
export type {
  ActionPart,
  ActionResult,
  FilePart,
  ProviderToolAction,
  SubagentAction,
  TextPart,
  ThinkingPart,
  ToolAction,
  Turn,
  TurnPart,
  TurnStatus,
} from "./turns/types.js";

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
export type {
  DeferredFileInfo,
  FileInfo,
  FileKind,
  FileProviderId,
  FileResolveFormat,
  FileResolveRequest,
  FileResolver,
  ResolvedFileSource,
} from "./utils/file.js";
export { createHandle } from "./utils/utils.js";
export type { Handle } from "./utils/utils.js";
