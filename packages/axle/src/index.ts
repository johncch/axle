// Core
export { PromptCompactor } from "./compaction/index.js";
export type { PromptCompactorOptions } from "./compaction/index.js";
export { configureAxle } from "./config.js";
export type { AxleConfiguration } from "./config.js";
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
  InstructContextSection,
  InstructInputs,
  InstructOptions,
  InstructRenderOptions,
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
export { anthropic } from "./providers/anthropic/index.js";
export { chatCompletions } from "./providers/chatcompletions/index.js";
export { inferChatCompletionsVendor } from "./providers/chatcompletions/provider.js";
export type {
  ChatCompletionsOptions,
  ChatCompletionsVendor,
} from "./providers/chatcompletions/provider.js";
export { estimateContextUsage } from "./providers/context.js";
export { gemini } from "./providers/gemini/index.js";
export type {
  GenerateInstructParams,
  GenerateInstructResult,
  GenerateParams,
} from "./providers/generate.js";
export type {
  AxleFailure,
  GenerateError,
  GenerateResult,
  StreamResult,
} from "./providers/helpers.js";
export { generate, stream } from "./providers/index.js";
export { openai } from "./providers/openai/index.js";
export type { ReasoningEffort, ReasoningSetting } from "./providers/reasoning.js";
export type {
  StreamEvent,
  StreamEventCallback,
  StreamHandle,
  StreamInstructHandle,
  StreamInstructParams,
  StreamInstructResult,
  StreamParams,
  ToolBatchCompleteCallback,
} from "./providers/stream.js";
export { AxleStopReason } from "./providers/types.js";
export type {
  AIProvider,
  AxleModelRequestOptions,
  ContextUsage,
  ProviderClientOptions,
  ProviderOptions,
  Refusal,
  ToolChoice,
} from "./providers/types.js";

// Tools
export { braveWebSearch, createAgentTool, parallelize } from "./tools/index.js";
export type {
  BraveWebSearchOptions,
  CreateAgentToolOptions,
  ExecutableTool,
  ParallelToolResult,
  ParallelizeOptions,
  ProviderTool,
  ToolContext,
  ToolDefinition,
  ToolProgressChunk,
  WebSearchBackend,
  WebSearchBackendContext,
  WebSearchRequest,
  WebSearchResponse,
  WebSearchResult,
} from "./tools/index.js";
export { ToolRegistry } from "./tools/registry.js";

// Skills
export {
  createViewSkillTool,
  loadSkill,
  parseSkillMarkdown,
  renderSkillsCatalog,
} from "./skills/index.js";
export type { Skill, SkillDefinitionRef, SkillFrontmatter } from "./skills/index.js";

// MCP
export { MCP } from "./mcp/index.js";
export type { MCPConfig, MCPHttpConfig, MCPStdioConfig } from "./mcp/index.js";

// Messages (internal — kept for advanced/direct stream() users)
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
  ContentPartProviderToolResult,
  ContentPartText,
  ContentPartThinking,
  ContentPartToolCall,
  DocumentLocator,
  MessageMetadata,
  ThinkingContinuity,
  ToolResultPart,
} from "./messages/message.js";
export type {
  AnthropicServerToolResultBlock,
  ConsoleOutput,
  OpenAIProviderToolItem,
  ProviderToolContinuity,
  ProviderToolInput,
  ProviderToolResult,
  ProviderToolResultContinuity,
} from "./messages/providerTool.js";

// Compaction (@experimental)
export type {
  AutomaticCompactionTrigger,
  CompactionCallback,
  CompactionConfig,
  CompactionTrigger,
  ShouldCompactOnTriggerCallback,
} from "./core/agent/index.js";
export { getCompactionStamp, validateCompactedMessages } from "./messages/compaction.js";
export type { CompactionStamp } from "./messages/compaction.js";

// Turns (public format)
export { TurnEventBuilder } from "./turns/eventBuilder.js";
export type { AnnotationEvent, AnnotationTarget, TurnEvent } from "./turns/events.js";
export { Transcript } from "./turns/transcript.js";
export type { TranscriptApplyResult, TranscriptInput } from "./turns/transcript.js";
export type {
  ActionPart,
  ActionResult,
  Annotation,
  AnnotationPlacement,
  AnnotationStatus,
  CitationPart,
  CompactionPart,
  CompactionUpdate,
  FilePart,
  PendingDropReason,
  PendingEntry,
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

// Models
export { ModelCatalog } from "./models/catalog.js";
export type {
  CatalogMatch,
  CatalogModel,
  ContextWindowMatch,
  ModelCatalogOptions,
  ModelCost,
} from "./models/catalog.js";

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
export type { Handle } from "./utils/utils.js";
