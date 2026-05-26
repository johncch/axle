// Core
export { Agent, createAgentConfig } from "./core/agent/index.js";
export type {
  AgentConfig,
  AgentDefinition,
  AgentDefinitionRequestOptions,
  AgentDefinitionResolver,
  AgentErrorResult,
  AgentHandle,
  AgentResult,
  AgentSession,
  MaybePromise,
  ProviderDefinition,
  ProviderToolDefinitionRef,
  ResolvedAgentDefinition,
  SavedAgent,
  SendMessageOptions,
  ToolDefinitionRef,
  TurnEventCallback,
} from "./core/agent/index.js";
export { Instruct } from "./core/index.js";
export type {
  InstructInputs,
  InstructOptions,
  InstructResponse,
  InstructVarsMode,
  OutputSchema,
  ParsedSchema,
} from "./core/index.js";
export { parseResponse } from "./core/parse.js";
export {
  AxleAbortError,
  AxleAgentAbortError,
  AxleError,
  AxleToolFatalError,
  InstructVariableError,
  TaskError,
} from "./errors/index.js";

// AI Providers
export { Anthropic, anthropic } from "./providers/anthropic/index.js";
export { chatCompletions } from "./providers/chatcompletions/index.js";
export { estimateContextUsage } from "./providers/context.js";
export { Gemini, gemini } from "./providers/gemini/index.js";
export type {
  GenerateInstructParams,
  GenerateInstructResult,
  GenerateParams,
} from "./providers/generate.js";
export type { StreamResult } from "./providers/helpers.js";
export { generate, generateTurn, stream } from "./providers/index.js";
export { OpenAI, openai } from "./providers/openai/index.js";
export type {
  StreamEvent,
  StreamEventCallback,
  StreamHandle,
  StreamInstructHandle,
  StreamInstructParams,
  StreamInstructResult,
  StreamParams,
} from "./providers/stream.js";
export { AxleStopReason } from "./providers/types.js";
export type {
  AIProvider,
  AnthropicProviderConfig,
  AxleModelRequestOptions,
  ChatCompletionsProviderConfig,
  ContextUsage,
  GeminiProviderConfig,
  OpenAIProviderConfig,
  ProviderOptions,
  ToolChoice,
} from "./providers/types.js";

// Tools
export { ToolRegistry } from "./tools/registry.js";
export type { ExecutableTool, ProviderTool, ToolContext, ToolDefinition } from "./tools/types.js";

// MCP
export { MCP } from "./mcp/index.js";
export type { MCPConfig, MCPHttpConfig, MCPStdioConfig } from "./mcp/index.js";

// Messages (internal — kept for advanced/direct stream() users)
export { History } from "./core/agent/index.js";
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
  MessageMetadata,
  ToolResultPart,
} from "./messages/message.js";

// Turns (public format)
export { TurnAccumulator } from "./turns/accumulator.js";
export type {
  AccumulatableEvent,
  TurnAccumulatorResult,
  TurnAccumulatorState,
} from "./turns/accumulator.js";
export { TurnEventBuilder } from "./turns/eventBuilder.js";
export type { AnnotationEvent, AnnotationTarget, TurnEvent } from "./turns/events.js";
export type {
  ActionPart,
  ActionResult,
  Annotation,
  AnnotationPlacement,
  AnnotationStatus,
  FilePart,
  ProviderToolAction,
  SubagentAction,
  TextPart,
  ThinkingPart,
  ToolAction,
  Turn,
  TurnMetadata,
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
export type { Stats } from "./types.js";

// Memory
export type { AgentMemory, MemoryContext, RecallResult } from "./memory/index.js";

// Store
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
export { addStats, createStats } from "./utils/stats.js";
export { createHandle } from "./utils/utils.js";
export type { Handle } from "./utils/utils.js";
