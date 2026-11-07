// Core
export { PromptCompactor } from "./compaction/index.js";
export type { PromptCompactorOptions } from "./compaction/index.js";
export { Agent } from "./core/agent/index.js";
export type {
  AgentConfig,
  AgentErrorResult,
  AgentEventCallback,
  AgentHandle,
  AgentResult,
  AgentSession,
  AgentStatus,
  Continuation,
  ContinuationContext,
  IdleCallback,
  InlineSendOptions,
  InlineTurn,
  MaybePromise,
  ObservabilityOptions,
  SendMessageOptions,
  SettledCallback,
  SettledOperation,
  StartCallback,
  StartedOperation,
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
  AxleErrorCode,
  AxleInstructVariableError,
  AxleToolFatalError,
  isAxleError,
} from "./errors/index.js";

// Protocols
export { chatCompletions } from "./protocols/chatCompletions/chatCompletions.js";
export type { ChatCompletionsOptions } from "./protocols/chatCompletions/chatCompletions.js";
export type {
  ChatCompletionsDialect,
  ChatCompletionsReasoningDetails,
} from "./protocols/chatCompletions/dialect.js";
export { openrouterDialect } from "./protocols/chatCompletions/dialects/openrouter.js";
export { togetheraiDialect } from "./protocols/chatCompletions/dialects/togetherai.js";
export { generateContent } from "./protocols/generateContent/generateContent.js";
export { messages } from "./protocols/messages/messages.js";
export { responses } from "./protocols/responses/responses.js";

// Providers
export { anthropic } from "./providers/anthropic.js";
export { bedrock } from "./providers/bedrock.js";
export type { BedrockOptions } from "./providers/bedrock.js";
export { openrouter } from "./providers/openrouter.js";
export { togetherai } from "./providers/togetherai.js";

export { estimateContextUsage } from "./execution/context.js";

// Decisions (@experimental)
export { choice, decide, noul, score } from "./execution/decide.js";
export type {
  AnswerFor,
  ChoiceAnswer,
  ChoiceQuestion,
  DecideParams,
  DecideResult,
  DecisionAnswer,
  DecisionAnswers,
  DecisionInput,
  DecisionJson,
  DecisionProvider,
  DecisionQuestion,
  DecisionQuestions,
  DecisionRefusal,
  DecisionRequestParams,
  DecisionResponse,
  NoulAnswer,
  NoulQuestion,
  ScoreAnswer,
  ScoreQuestion,
} from "./execution/decide.js";
export { generate } from "./execution/generate.js";
export type {
  GenerateInstructParams,
  GenerateInstructResult,
  GenerateParams,
} from "./execution/generate.js";
export type { AxleProviderFailure, GenerateResult, StreamResult } from "./execution/helpers.js";
export { stream } from "./execution/stream.js";
export type {
  StreamEvent,
  StreamEventCallback,
  StreamHandle,
  StreamInstructHandle,
  StreamInstructParams,
  StreamInstructResult,
  StreamParams,
  ToolBatchCompleteCallback,
  ToolBatchDecision,
} from "./execution/stream.js";
export type { ReasoningEffort, ReasoningSetting } from "./protocols/reasoning.js";
export { AxleStopReason } from "./protocols/types.js";
export type {
  AIProvider,
  AxleModelRequestOptions,
  ContextUsage,
  Protocol,
  ProtocolOptions,
  ProviderClientOptions,
  ProviderOptions,
  Refusal,
  ToolChoice,
} from "./protocols/types.js";
export { gemini } from "./providers/gemini.js";
export { openai } from "./providers/openai.js";
export { typesafe } from "./providers/typesafe/index.js";
export type { TypesafeOptions } from "./providers/typesafe/index.js";

// Tools
export { braveWebSearch, createAgentTool, isActionOf, isCall, parallelize } from "./tools/index.js";
export type {
  AnyTool,
  BraveWebSearchOptions,
  CreateAgentToolOptions,
  DeferredActionOf,
  DeferredCall,
  DeferredCallOf,
  DeferredTool,
  ExecutableTool,
  ParallelToolResult,
  ParallelizeOptions,
  ProviderTool,
  ToolCallCallback,
  ToolContext,
  ToolDefinition,
  ToolProgressChunk,
  WaitingToolCall,
  WebSearchResult,
} from "./tools/index.js";
export { ToolRegistry } from "./tools/registry.js";

// Skills
export {
  SkillRegistry,
  createViewSkillTool,
  loadSkill,
  parseSkillMarkdown,
  renderSkillsCatalog,
} from "./skills/index.js";
export type { Skill, SkillFrontmatter } from "./skills/index.js";

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

// Cost (@experimental)
export { computeCost } from "./models/cost.js";
export type { Cost, PricedEntry, UnpricedEntry, UnpricedReason } from "./models/cost.js";

// Turns (public format)
export { TurnEventBuilder } from "./turns/eventBuilder.js";
export type {
  AgentEvent,
  AgentStateEvent,
  AnnotationEvent,
  AnnotationTarget,
  TurnEvent,
} from "./turns/events.js";
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
  DeferredAction,
  FilePart,
  OperationOutcome,
  PendingDropReason,
  ProviderToolAction,
  SubagentAction,
  TextPart,
  ThinkingPart,
  ToolAction,
  Turn,
  TurnFailure,
  TurnMetadata,
  TurnPart,
  TurnStatus,
} from "./turns/types.js";

// Remote (@experimental)
export { InMemoryEventStore } from "./remote/eventStore.js";
export type { StoredEvent } from "./remote/eventStore.js";
export { HttpTransportError, httpTransport } from "./remote/httpTransport.js";
export type { HttpTransportOptions } from "./remote/httpTransport.js";
export { loopbackTransport } from "./remote/loopback.js";
export { agentCommandSchema, commandOutcomeSchema, parseAgentCommand } from "./remote/protocol.js";
export type {
  AgentCommand,
  AgentSubscription,
  AgentTransport,
  CommandOutcome,
  StreamItem,
} from "./remote/protocol.js";
export { RemoteAgent } from "./remote/RemoteAgent.js";
export type {
  RemoteConnection,
  RemoteHandle,
  RemoteSendOptions,
  RemoteWaitingToolCall,
} from "./remote/RemoteAgent.js";
export { toEventStreamResponse } from "./remote/sse.js";

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

// Models (@experimental)
export { ModelCatalog, parseCatalogData } from "./models/catalog.js";
export type {
  CatalogData,
  CatalogMatch,
  CatalogModel,
  ContextWindowMatch,
  ModelCost,
} from "./models/catalog.js";
export { CatalogFetchError, fetchModelsDev } from "./models/modelsDev.js";
export type { FetchModelsDevOptions } from "./models/modelsDev.js";
export { ModelCatalogStore, catalogFile } from "./models/store.js";
export type { CatalogStorage, ModelCatalogStoreOptions } from "./models/store.js";

// Utils
export { loadFileContent } from "./utils/file.js";
export type {
  DeferredFileInfo,
  FileInfo,
  FileKind,
  FileResolveFormat,
  FileResolveRequest,
  FileResolver,
  ResolvedFileSource,
} from "./utils/file.js";
export { addStats, attributeStats, createStats, mergeStats } from "./utils/stats.js";
export type { Handle } from "./utils/utils.js";
