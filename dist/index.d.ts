import * as z from 'zod';
import z__default, { ZodObject, z as z$1 } from 'zod';

type PlainObject = Record<string, unknown>;
type ProgramOptions = {
    dryRun?: boolean;
    config?: string;
    warnUnused?: boolean;
    job?: string;
    log?: boolean;
    debug?: boolean;
    args?: string[];
};
interface Stats {
    in: number;
    out: number;
}
interface Task {
    readonly type: string;
}

interface RecorderLevelFunctions {
    log: (...message: (string | unknown | Error)[]) => void;
    heading: {
        log: (...message: (string | unknown | Error)[]) => void;
    };
}
type RecorderEntry = {
    level: LogLevel;
    time: number;
    kind: VisualLevel;
    payload: PlainObject[];
};
type VisualLevel = "heading" | "body";
declare enum LogLevel {
    Trace = 10,
    Debug = 20,
    Info = 30,
    Warn = 40,
    Error = 50,
    Fatal = 60
}
interface RecorderWriter {
    handleEvent(event: RecorderEntry): void | Promise<void>;
    flush?(): Promise<void>;
}

interface StreamChunk {
    type: "start" | "text" | "tool-call-start" | "tool-call-delta" | "tool-call-complete" | "thinking-start" | "thinking-delta" | "complete" | "error";
    id?: string;
    data?: any;
}
interface StreamStartChunk extends StreamChunk {
    type: "start";
    id: string;
    data: {
        model: string;
        timestamp: number;
    };
}
interface StreamCompleteChunk extends StreamChunk {
    type: "complete";
    data: {
        finishReason: AxleStopReason;
        usage: Stats;
    };
}
interface StreamTextChunk extends StreamChunk {
    type: "text";
    data: {
        text: string;
        index: number;
    };
}
interface StreamThinkingStartChunk extends StreamChunk {
    type: "thinking-start";
    data: {
        index: number;
        redacted?: boolean;
    };
}
interface StreamThinkingDeltaChunk extends StreamChunk {
    type: "thinking-delta";
    data: {
        index: number;
        text: string;
    };
}
interface StreamToolCallStartChunk extends StreamChunk {
    type: "tool-call-start";
    data: {
        index: number;
        id: string;
        name: string;
    };
}
interface StreamToolCallCompleteChunk extends StreamChunk {
    type: "tool-call-complete";
    data: {
        index: number;
        id: string;
        name: string;
        arguments: any;
    };
}
interface StreamErrorChunk extends StreamChunk {
    type: "error";
    data: {
        type: string;
        message: string;
        usage?: Stats;
        raw?: any;
    };
}
type AnyStreamChunk = StreamStartChunk | StreamCompleteChunk | StreamTextChunk | StreamToolCallStartChunk | StreamToolCallCompleteChunk | StreamThinkingStartChunk | StreamThinkingDeltaChunk | StreamErrorChunk;

declare class Recorder {
    instanceId: `${string}-${string}-${string}-${string}-${string}`;
    private currentLevel;
    private logs;
    private writers;
    private _debug;
    private _info;
    private _warn;
    private _error;
    constructor();
    buildMethods(): void;
    set level(level: LogLevel);
    get level(): LogLevel;
    get info(): RecorderLevelFunctions;
    get warn(): RecorderLevelFunctions;
    get error(): RecorderLevelFunctions;
    get debug(): RecorderLevelFunctions;
    subscribe(writer: RecorderWriter): void;
    unsubscribe(writer: RecorderWriter): void;
    private publish;
    private logFunction;
    private createLoggingFunction;
    getLogs(level?: LogLevel): RecorderEntry[];
    /**
     * Ensures all writers have completed their pending operations
     * Call this before exiting the process to ensure logs are written
     */
    shutdown(): Promise<void>;
}

interface FileInfo {
    path: string;
    base64?: string;
    content?: string;
    mimeType: string;
    size: number;
    name: string;
    type: "image" | "document" | "text";
}
type TextFileInfo = FileInfo & {
    content: string;
    base64?: never;
    type: "text";
};
type Base64FileInfo = FileInfo & {
    base64: string;
    content?: never;
    type: "image" | "document";
};

type AxleMessage = AxleUserMessage | AxleAssistantMessage | AxleToolCallMessage;
interface AxleUserMessage {
    role: "user";
    name?: string;
    content: string | Array<ContentPart>;
}
interface AxleAssistantMessage {
    role: "assistant";
    id: string;
    model?: string;
    content: Array<ContentPartText | ContentPartThinking | ContentPartToolCall>;
    finishReason?: AxleStopReason;
}
interface AxleToolCallMessage {
    role: "tool";
    content: Array<AxleToolCallResult>;
}
interface AxleToolCallResult {
    id: string;
    name: string;
    content: string;
}
type ContentPart = ContentPartText | ContentPartFile | ContentPartToolCall | ContentPartThinking;
interface ContentPartText {
    type: "text";
    text: string;
}
interface ContentPartFile {
    type: "file";
    file: FileInfo;
}
interface ContentPartThinking {
    type: "thinking";
    text: string;
    redacted?: boolean;
    encrypted?: string;
    signature?: string;
}
interface ContentPartToolCall {
    type: "tool-call";
    id: string;
    name: string;
    parameters: Record<string, unknown>;
}

type ToolDefinition<Z extends ZodObject = ZodObject> = {
    name: string;
    description?: string;
    schema: Z;
};
interface ToolExecutable<Z extends ZodObject = ZodObject> extends ToolDefinition<Z> {
    setConfig?: (config: {
        [key: string]: any;
    }) => void;
    execute: (params: z$1.infer<Z>) => Promise<string>;
}

type OllamaProviderConfig = {
    url?: string;
    model: string;
};
type AnthropicProviderConfig = {
    "api-key": string;
    model?: string;
};
type OpenAIProviderConfig = {
    "api-key": string;
    model?: string;
};
type GeminiProviderConfig = {
    "api-key": string;
    model?: string;
};
interface AIProviderConfig {
    ollama: OllamaProviderConfig;
    anthropic: AnthropicProviderConfig;
    openai: OpenAIProviderConfig;
    gemini: GeminiProviderConfig;
}
interface AIProvider {
    get name(): string;
    get model(): string;
    createGenerationRequest(params: {
        messages: Array<AxleMessage>;
        system?: string;
        tools?: Array<ToolDefinition>;
        context: {
            recorder?: Recorder;
        };
        options?: {
            temperature?: number;
            top_p?: number;
            max_tokens?: number;
            frequency_penalty?: number;
            presence_penalty?: number;
            stop?: string | string[];
            [key: string]: any;
        };
    }): Promise<ModelResult>;
    createStreamingRequest?(params: {
        messages: Array<AxleMessage>;
        system?: string;
        tools?: Array<ToolDefinition>;
        context: {
            recorder?: Recorder;
        };
        options?: {
            temperature?: number;
            top_p?: number;
            max_tokens?: number;
            frequency_penalty?: number;
            presence_penalty?: number;
            stop?: string | string[];
            [key: string]: any;
        };
    }): AsyncGenerator<AnyStreamChunk, void, unknown>;
}
interface ModelResponse {
    type: "success";
    role: "assistant";
    id: string;
    model: string;
    text: string;
    content: Array<ContentPartText | ContentPartThinking | ContentPartToolCall>;
    finishReason: AxleStopReason;
    usage: Stats;
    raw: any;
}
interface ModelError {
    type: "error";
    error: {
        type: string;
        message: string;
    };
    usage?: Stats;
    raw?: any;
}
type ModelResult = ModelResponse | ModelError;
declare enum AxleStopReason {
    Stop = 0,
    Length = 1,
    FunctionCall = 2,
    Error = 3,
    Custom = 4
}

declare class AxleError extends Error {
    readonly code: string;
    readonly id?: string;
    readonly details?: Record<string, any>;
    constructor(message: string, options?: {
        code?: string;
        id?: string;
        details?: Record<string, any>;
        cause?: Error;
    });
}

interface Planner {
    plan(tasks: Task[]): Promise<Run[]>;
}

interface Run {
    tasks: Task[];
    variables: Record<string, any>;
}
interface SerializedExecutionResponse {
    response: string;
    stats: Stats;
}
interface WorkflowResult<T = any> {
    response: T;
    stats?: Stats;
    error?: AxleError;
    success: boolean;
}
interface WorkflowExecutable {
    execute: (context: {
        provider: AIProvider;
        variables: Record<string, any>;
        options?: ProgramOptions;
        stats?: Stats;
        recorder?: Recorder;
        name?: string;
    }) => Promise<WorkflowResult>;
}
interface DAGNodeDefinition {
    task: Task | Task[];
    dependsOn?: string | string[];
}
interface DAGConcurrentNodeDefinition {
    planner: Planner;
    tasks: Task[];
    dependsOn?: string | string[];
}
interface DAGDefinition {
    [nodeName: string]: Task | Task[] | DAGNodeDefinition | DAGConcurrentNodeDefinition;
}
interface DAGWorkflowOptions {
    continueOnError?: boolean;
    maxConcurrency?: number;
}

declare class Axle {
    provider: AIProvider;
    private stats;
    private variables;
    recorder: Recorder;
    constructor(config: Partial<AIProviderConfig>);
    addWriter(writer: RecorderWriter): void;
    /**
     * The execute function takes in a list of Tasks
     * @param tasks
     * @returns
     */
    execute(...tasks: Task[]): Promise<WorkflowResult>;
    /**
     * Execute a DAG workflow
     * @param dagDefinition - The DAG definition object
     * @param variables - Additional variables to pass to the workflow
     * @param options - DAG execution options
     * @returns Promise<WorkflowResult>
     */
    executeDAG(dagDefinition: DAGDefinition, variables?: Record<string, any>, options?: DAGWorkflowOptions): Promise<WorkflowResult>;
    get logs(): RecorderEntry[];
    /**
     * Load a file with the specified encoding or auto-detect based on file extension
     * @param filePath - Path to the file
     * @param encoding - How to load the file: "utf-8" for text, "base64" for binary, or omit for auto-detection
     * @returns FileInfo object with appropriate content based on encoding
     */
    static loadFileContent(filePath: string): Promise<FileInfo>;
    static loadFileContent(filePath: string, encoding: "utf-8"): Promise<TextFileInfo>;
    static loadFileContent(filePath: string, encoding: "base64"): Promise<Base64FileInfo>;
}

declare const Models$2: {
    readonly CLAUDE_SONNET_4_5_20250929: "claude-sonnet-4-5-20250929";
    readonly CLAUDE_SONNET_4_5_LATEST: "claude-sonnet-4-5";
    readonly CLAUDE_HAIKU_4_5: "claude-haiku-4-5";
    readonly CLAUDE_OPUS_4_1_20250805: "claude-opus-4-1-20250805";
    readonly CLAUDE_OPUS_4_1_LATEST: "claude-opus-4-1";
    readonly CLAUDE_OPUS_4_20250514: "claude-opus-4-20250514";
    readonly CLAUDE_OPUS_4_LATEST: "claude-opus-4-0";
    readonly CLAUDE_SONNET_4_20250514: "claude-sonnet-4-20250514";
    readonly CLAUDE_SONNET_4_LATEST: "claude-sonnet-4-0";
    readonly CLAUDE_3_7_SONNET_20250219: "claude-3-7-sonnet-20250219";
    readonly CLAUDE_3_7_SONNET_LATEST: "claude-3-7-sonnet-latest";
    readonly CLAUDE_3_5_SONNET_20241022: "claude-3-5-sonnet-20241022";
    readonly CLAUDE_3_5_HAIKU_20241022: "claude-3-5-haiku-20241022";
    readonly CLAUDE_3_5_HAIKU_LATEST: "claude-3-5-haiku-latest";
    readonly CLAUDE_3_5_SONNET_20240620: "claude-3-5-sonnet-20240620";
};
declare const DEFAULT_MODEL$2: "claude-haiku-4-5";

declare const NAME$3: "anthorpic";

declare namespace index$3 {
  export {
    DEFAULT_MODEL$2 as DEFAULT_MODEL,
    Models$2 as Models,
    NAME$3 as NAME,
  };
}

declare const Models$1: {
    readonly GEMINI_2_5_PRO: "gemini-2.5-pro";
    readonly GEMINI_2_5_FLASH: "gemini-2.5-flash";
    readonly GEMINI_2_5_FLASH_PREVIEW_05_20: "gemini-2.5-flash-preview-05-20";
    readonly GEMINI_2_5_FLASH_LITE: "gemini-2.5-flash-lite";
    readonly GEMINI_2_5_FLASH_LITE_PREVIEW_06_17: "gemini-2.5-flash-lite-preview-06-17";
    readonly GEMINI_2_5_FLASH_LIVE_PREVIEW: "gemini-live-2.5-flash-preview";
    readonly GEMINI_2_5_FLASH_PREVIEW_NATIVE_AUDIO_DIALOG: "gemini-2.5-flash-preview-native-audio-dialog";
    readonly GEMINI_2_5_FLASH_EXP_NATIVE_AUDIO_THINKING_DIALOG: "gemini-2.5-flash-exp-native-audio-thinking-dialog";
    readonly GEMINI_2_5_FLASH_IMAGE_PREVIEW: "gemini-2.5-flash-image-preview";
    readonly GEMINI_2_5_FLASH_PREVIEW_TTS: "gemini-2.5-flash-preview-tts";
    readonly GEMINI_2_5_PRO_PREVIEW_TTS: "gemini-2.5-pro-preview-tts";
    readonly GEMINI_2_0_FLASH: "gemini-2.0-flash";
    readonly GEMINI_2_0_FLASH_001: "gemini-2.0-flash-001";
    readonly GEMINI_2_0_FLASH_EXP: "gemini-2.0-flash-exp";
    readonly GEMINI_2_0_FLASH_PREVIEW_IMAGE_GENERATION: "gemini-2.0-flash-preview-image-generation";
    readonly GEMINI_2_0_FLASH_LITE: "gemini-2.0-flash-lite";
    readonly GEMINI_2_0_FLASH_LITE_001: "gemini-2.0-flash-lite-001";
    readonly GEMINI_2_0_FLASH_LIVE_001: "gemini-2.0-flash-live-001";
    readonly GEMINI_1_5_PRO: "gemini-1.5-pro";
    readonly GEMINI_1_5_PRO_LATEST: "gemini-1.5-pro-latest";
    readonly GEMINI_1_5_PRO_001: "gemini-1.5-pro-001";
    readonly GEMINI_1_5_PRO_002: "gemini-1.5-pro-002";
    readonly GEMINI_1_5_FLASH: "gemini-1.5-flash";
    readonly GEMINI_1_5_FLASH_LATEST: "gemini-1.5-flash-latest";
    readonly GEMINI_1_5_FLASH_001: "gemini-1.5-flash-001";
    readonly GEMINI_1_5_FLASH_002: "gemini-1.5-flash-002";
    readonly GEMINI_1_5_FLASH_8B: "gemini-1.5-flash-8b";
    readonly GEMINI_1_5_FLASH_8B_LATEST: "gemini-1.5-flash-8b-latest";
    readonly GEMINI_1_5_FLASH_8B_001: "gemini-1.5-flash-8b-001";
    readonly GEMMA_3N_E4B_IT: "gemma-3n-e4b-it";
    readonly GEMMA_3_1B_IT: "gemma-3-1b-it";
    readonly GEMMA_3_4B_IT: "gemma-3-4b-it";
    readonly GEMMA_3_12B_IT: "gemma-3-12b-it";
    readonly GEMMA_3_27B_IT: "gemma-3-27b-it";
    readonly LEARNLM_2_0_FLASH_EXPERIMENTAL: "learnlm-2.0-flash-experimental";
    readonly EMBEDDING_001: "embedding-001";
    readonly TEXT_EMBEDDING_004: "text-embedding-004";
};
declare const DEFAULT_MODEL$1: "gemini-2.5-flash";

declare const NAME$2: "Gemini";

declare namespace index$2 {
  export {
    DEFAULT_MODEL$1 as DEFAULT_MODEL,
    Models$1 as Models,
    NAME$2 as NAME,
  };
}

declare const DEFAULT_OLLAMA_URL = "http://localhost:11434";
declare const NAME$1: "Ollama";

declare const index$1_DEFAULT_OLLAMA_URL: typeof DEFAULT_OLLAMA_URL;
declare namespace index$1 {
  export {
    index$1_DEFAULT_OLLAMA_URL as DEFAULT_OLLAMA_URL,
    NAME$1 as NAME,
  };
}

declare const Models: {
    readonly GPT_5: "gpt-5";
    readonly GPT_5_MINI: "gpt-5-mini";
    readonly GPT_5_NANO: "gpt-5-nano";
    readonly GPT_5_CHAT_LATEST: "gpt-5-chat-latest";
    readonly GPT_5_PRO: "gpt-5-pro";
    readonly GPT_5_CODEX: "gpt-5-codex";
    readonly GPT_4_5_PREVIEW: "gpt-4.5-preview";
    readonly GPT_4_5_PREVIEW_2025_02_27: "gpt-4.5-preview-2025-02-27";
    readonly GPT_4_1: "gpt-4.1";
    readonly GPT_4_1_2025_04_14: "gpt-4.1-2025-04-14";
    readonly GPT_4_1_MINI: "gpt-4.1-mini";
    readonly GPT_4_1_MINI_2025_04_14: "gpt-4.1-mini-2025-04-14";
    readonly GPT_4_1_NANO: "gpt-4.1-nano";
    readonly GPT_4_1_NANO_2025_04_14: "gpt-4.1-nano-2025-04-14";
    readonly GPT_4O: "gpt-4o";
    readonly GPT_4O_2024_05_13: "gpt-4o-2024-05-13";
    readonly GPT_4O_2024_08_06: "gpt-4o-2024-08-06";
    readonly GPT_4O_2024_11_20: "gpt-4o-2024-11-20";
    readonly GPT_4O_MINI: "gpt-4o-mini";
    readonly GPT_4O_MINI_2024_07_18: "gpt-4o-mini-2024-07-18";
    readonly GPT_4O_AUDIO_PREVIEW: "gpt-4o-audio-preview";
    readonly GPT_4O_AUDIO_PREVIEW_2024_10_01: "gpt-4o-audio-preview-2024-10-01";
    readonly GPT_4O_AUDIO_PREVIEW_2024_12_17: "gpt-4o-audio-preview-2024-12-17";
    readonly GPT_4O_AUDIO_PREVIEW_2025_06_03: "gpt-4o-audio-preview-2025-06-03";
    readonly GPT_4O_MINI_AUDIO_PREVIEW: "gpt-4o-mini-audio-preview";
    readonly GPT_4O_MINI_AUDIO_PREVIEW_2024_12_17: "gpt-4o-mini-audio-preview-2024-12-17";
    readonly GPT_REALTIME: "gpt-realtime";
    readonly GPT_REALTIME_MINI: "gpt-realtime-mini";
    readonly GPT_4O_REALTIME_PREVIEW: "gpt-4o-realtime-preview";
    readonly GPT_4O_REALTIME_PREVIEW_2024_10_01: "gpt-4o-realtime-preview-2024-10-01";
    readonly GPT_4O_REALTIME_PREVIEW_2024_12_17: "gpt-4o-realtime-preview-2024-12-17";
    readonly GPT_4O_REALTIME_PREVIEW_2025_06_03: "gpt-4o-realtime-preview-2025-06-03";
    readonly GPT_4O_MINI_REALTIME_PREVIEW: "gpt-4o-mini-realtime-preview";
    readonly GPT_4O_MINI_REALTIME_PREVIEW_2024_12_17: "gpt-4o-mini-realtime-preview-2024-12-17";
    readonly GPT_4O_SEARCH_PREVIEW: "gpt-4o-search-preview";
    readonly GPT_4O_SEARCH_PREVIEW_2025_03_11: "gpt-4o-search-preview-2025-03-11";
    readonly GPT_4O_MINI_SEARCH_PREVIEW: "gpt-4o-mini-search-preview";
    readonly GPT_4O_MINI_SEARCH_PREVIEW_2025_03_11: "gpt-4o-mini-search-preview-2025-03-11";
    readonly GPT_4O_TRANSCRIBE: "gpt-4o-transcribe";
    readonly GPT_4O_MINI_TRANSCRIBE: "gpt-4o-mini-transcribe";
    readonly GPT_4O_MINI_TTS: "gpt-4o-mini-tts";
    readonly GPT_IMAGE_1: "gpt-image-1";
    readonly GPT_IMAGE_1_MINI: "gpt-image-1-mini";
    readonly O4_MINI: "o4-mini";
    readonly O4_MINI_2025_04_16: "o4-mini-2025-04-16";
    readonly O3: "o3";
    readonly O3_PRO: "o3-pro";
    readonly O3_MINI: "o3-mini";
    readonly O3_MINI_2025_01_31: "o3-mini-2025-01-31";
    readonly O1_PRO: "o1-pro";
    readonly O1_PRO_2025_03_19: "o1-pro-2025-03-19";
    readonly O1: "o1";
    readonly O1_2024_12_17: "o1-2024-12-17";
    readonly O1_MINI: "o1-mini";
    readonly O1_MINI_2024_09_12: "o1-mini-2024-09-12";
    readonly O1_PREVIEW: "o1-preview";
    readonly O1_PREVIEW_2024_09_12: "o1-preview-2024-09-12";
    readonly GPT_OSS_120B: "gpt-oss-120b";
    readonly GPT_OSS_7B: "gpt-oss-7b";
    readonly SORA_2: "sora-2";
    readonly SORA_2025_05_02: "sora-2025-05-02";
    readonly CODEX_MINI: "codex-mini";
    readonly COMPUTER_USE_PREVIEW: "computer-use-preview";
};
declare const DEFAULT_MODEL: "gpt-5";

declare const NAME: "OpenAI";

declare const index_DEFAULT_MODEL: typeof DEFAULT_MODEL;
declare const index_Models: typeof Models;
declare const index_NAME: typeof NAME;
declare namespace index {
  export {
    index_DEFAULT_MODEL as DEFAULT_MODEL,
    index_Models as Models,
    index_NAME as NAME,
  };
}

interface GenerateOptions {
    temperature?: number;
    top_p?: number;
    max_tokens?: number;
    frequency_penalty?: number;
    presence_penalty?: number;
    stop?: string | string[];
    [key: string]: any;
}
interface GenerateProps {
    provider: AIProvider;
    messages: Array<AxleMessage>;
    system?: string;
    tools?: Array<ToolDefinition>;
    recorder?: Recorder;
    options?: GenerateOptions;
}
declare function generate(props: GenerateProps): Promise<ModelResult>;

interface StreamProps {
    provider: AIProvider;
    messages: Array<AxleMessage>;
    system?: string;
    tools?: Array<ToolDefinition>;
    recorder?: Recorder;
    options?: GenerateOptions;
}
interface StreamResult {
    get final(): Promise<ModelResult>;
    get current(): AxleAssistantMessage;
    [Symbol.asyncIterator](): AsyncIterator<AnyStreamChunk>;
}
declare function stream(props: StreamProps): StreamResult;

declare enum ResultType {
    String = "string",
    List = "string[]",
    Number = "number",
    Boolean = "boolean"
}
type ResultTypeUnion = `${ResultType}`;
type DeclarativeSchema = {
    [key: string]: ResultTypeUnion | DeclarativeSchema | DeclarativeSchema[];
};
type OutputSchema = Record<string, z__default.ZodTypeAny>;
type InferedOutputSchema<T extends OutputSchema> = {
    [K in keyof T]: z__default.output<T[K]>;
};

declare abstract class AbstractInstruct<T extends OutputSchema> implements Task {
    readonly type = "instruct";
    prompt: string;
    system: string | null;
    inputs: Record<string, string>;
    tools: Record<string, ToolExecutable>;
    files: Base64FileInfo[];
    textReferences: Array<{
        content: string;
        name?: string;
    }>;
    instructions: string[];
    schema: T;
    rawResponse: string;
    protected _taggedSections: {
        tags: Record<string, string>;
        remaining: string;
    } | undefined;
    protected _result: InferedOutputSchema<T> | undefined;
    protected constructor(prompt: string, schema: T);
    setInputs(inputs: Record<string, string>): void;
    addInput(name: string, value: string): void;
    addTools(tools: ToolExecutable[]): void;
    addTool(tool: ToolExecutable): void;
    addImage(file: FileInfo): void;
    addDocument(file: FileInfo): void;
    addFile(file: FileInfo): void;
    addReference(textFile: FileInfo | TextFileInfo | string, options?: {
        name?: string;
    }): void;
    addInstructions(instruction: string): void;
    hasTools(): boolean;
    hasFiles(): boolean;
    get result(): InferedOutputSchema<T> | undefined;
    compile(variables: Record<string, string>, runtime?: {
        recorder?: Recorder;
        options?: {
            warnUnused?: boolean;
        };
    }): {
        message: string;
        instructions: string;
    };
    protected createUserMessage(variables: Record<string, string>, runtime?: {
        recorder?: Recorder;
        options?: {
            warnUnused?: boolean;
        };
    }): string;
    protected createInstructions(instructions?: string): string;
    protected generateFieldInstructions(key: string, schema: z.ZodTypeAny): string;
    finalize(rawValue: string, runtime?: {
        recorder?: Recorder;
    }): InferedOutputSchema<T>;
    private preprocessValue;
    protected parseTaggedSections(input: string): {
        tags: Record<string, string>;
        remaining: string;
    };
}

declare class Instruct<T extends OutputSchema> extends AbstractInstruct<T> {
    constructor(prompt: string, schema: T);
    static with<T extends OutputSchema>(prompt: string, schema: T): Instruct<T>;
    static with<T extends DeclarativeSchema>(prompt: string, schema: T): Instruct<OutputSchema>;
    static with(prompt: string): Instruct<{
        response: z.ZodString;
    }>;
}

declare class ChainOfThought<T extends OutputSchema> extends AbstractInstruct<T> {
    constructor(prompt: string, schema: T);
    static with<T extends OutputSchema>(prompt: string, schema: T): ChainOfThought<T>;
    static with<T extends DeclarativeSchema>(prompt: string, schema: T): ChainOfThought<OutputSchema>;
    static with(prompt: string): ChainOfThought<{
        response: z.ZodString;
    }>;
    createInstructions(instructions?: string): string;
    finalize(rawValue: string, runtime?: {
        recorder?: Recorder;
    }): InferedOutputSchema<T> & {
        thinking: string;
    };
}

interface WriteToDiskTask extends Task {
    type: "write-to-disk";
    output: string;
    keys: string[];
}
declare class WriteOutputTask implements WriteToDiskTask {
    output: string;
    keys: string[];
    type: "write-to-disk";
    constructor(output: string, keys?: string[]);
}

interface DAGJob {
    [name: string]: Job & {
        dependsOn?: string | string[];
    };
}
type Job = SerialJob | BatchJob;
interface SerialJob {
    tools?: string[];
    steps: Step[];
}
interface BatchJob {
    tools?: string[];
    batch: BatchOptions[];
    steps: Step[];
}
interface SkipOptions {
    type: "file-exist";
    pattern: string;
}
interface BatchOptions {
    type: "files";
    source: string;
    bind: string;
    ["skip-if"]?: SkipOptions[];
}
type Step = ChatStep | WriteToDiskStep;
interface StepBase {
    readonly uses: string;
}
interface ChatStep extends StepBase {
    uses: "chat";
    system?: string;
    message: string;
    output?: Record<string, ResultTypeUnion>;
    replace?: Replace[];
    tools?: string[];
    images?: ImageReference[];
    documents?: DocumentReference[];
    references?: TextFileReference[];
}
interface WriteToDiskStep extends StepBase {
    uses: "write-to-disk";
    output: string;
    keys?: string | string[];
}
interface Replace {
    source: "file";
    pattern: string;
    files: string | string[];
}
interface ImageReference {
    file: string;
}
interface DocumentReference {
    file: string;
}
interface TextFileReference {
    file: string;
}

interface ConcurrentWorkflow {
    (jobConfig: BatchJob): WorkflowExecutable;
    (planner: Planner, ...instructions: Task[]): WorkflowExecutable;
}
declare const concurrentWorkflow: ConcurrentWorkflow;

interface DAGWorkflow {
    (definition: DAGDefinition | DAGJob, options?: DAGWorkflowOptions): WorkflowExecutable;
}
declare const dagWorkflow: DAGWorkflow;

interface SerialWorkflow {
    (jobConfig: SerialJob): WorkflowExecutable;
    (...instructions: Task[]): WorkflowExecutable;
}
declare const serialWorkflow: SerialWorkflow;

declare class ConsoleWriter implements RecorderWriter {
    private tasks;
    private entries;
    private truncate;
    private intervalId;
    private spinnerInterval;
    private lastRender;
    private isRendering;
    private inline;
    constructor(options?: {
        truncate?: number;
        inline?: boolean;
    });
    private startSpinner;
    private stopSpinner;
    private renderTasks;
    handleEvent(event: RecorderEntry): void;
    destroy(): void;
}

export { index$3 as Anthropic, Axle, ChainOfThought, ConsoleWriter, index$2 as Gemini, Instruct, LogLevel, index$1 as Ollama, index as OpenAI, WriteOutputTask, concurrentWorkflow, dagWorkflow, generate, serialWorkflow, stream };
export type { AIProvider, DAGDefinition, DAGWorkflowOptions, FileInfo, SerializedExecutionResponse };
