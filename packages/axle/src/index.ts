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
  ObservabilityOptions,
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
export type { ChatCompletionsOptions } from "./providers/chatcompletions/provider.js";
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
  AxleModelRequestOptions,
  ContextUsage,
  ProviderClientOptions,
  ProviderOptions,
  ToolChoice,
} from "./providers/types.js";

// Tools
export { createAgentTool, parallelize } from "./tools/index.js";
export type {
  CreateAgentToolOptions,
  ExecutableTool,
  ParallelToolResult,
  ParallelizeOptions,
  ProviderTool,
  ToolContext,
  ToolDefinition,
  ToolProgressChunk,
} from "./tools/index.js";
export { ToolRegistry } from "./tools/registry.js";

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
  Citation,
  CitationOutputSpan,
  CitationSource,
  ContentPart,
  ContentPartCitation,
  ContentPartFile,
  ContentPartProviderTool,
  ContentPartText,
  ContentPartThinking,
  ContentPartToolCall,
  DocumentLocator,
  MessageMetadata,
  ThinkingContinuity,
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
  CitationPart,
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
export { LogWriter, SimpleWriter, Tracer } from "./observability/index.js";
export type {
  EventLevel,
  LLMRequest,
  LLMResponse,
  LLMResult,
  LogEntry,
  LogFn,
  SimpleWriterOptions,
  Span,
  SpanData,
  SpanEvent,
  SpanOptions,
  SpanResult,
  SpanStatus,
  SpanType,
  TokenUsage,
  ToolResult,
  TraceWriter,
  TracerOptions,
} from "./observability/index.js";
export type { Stats, TokenStats, UsageEntry } from "./types.js";

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
export { addStats, createStats, mergeStats } from "./utils/stats.js";
export { createHandle } from "./utils/utils.js";
export type { Handle } from "./utils/utils.js";
