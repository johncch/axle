export type PlainObject = Record<string, unknown>;

export type ProgramOptions = {
  dryRun?: boolean;
  config?: string;
  warnUnused?: boolean;
  job?: string;
  log?: boolean;
  debug?: boolean;
  args?: string[];
};

export interface Stats {
  in: number;
  out: number;
}

export interface Task {
  readonly type: string;
  _executable?: Executable;
}

export interface TaskResult {
  outputs: Record<string, any>;
}

export interface ExecutableContext {
  variables: Record<string, any>;
  options?: ProgramOptions;
  recorder?: import("./recorder/recorder.js").Recorder;
}

export interface LLMContext {
  conversation: import("./messages/conversation.js").Conversation;
  provider: import("./ai/types.js").AIProvider;
  stats: Stats;
  variables: Record<string, any>;
  recorder?: import("./recorder/recorder.js").Recorder;
}

export interface Executable<TInput = any, TOutput = any> {
  name: string;
  description?: string;
  schema: import("zod").ZodObject<any>;
  execute(input: TInput, context: ExecutableContext): Promise<TOutput>;
}
