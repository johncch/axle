import { Executable, ExecutableContext, TaskResult } from "../types.js";

export class ExecutableExecutor {
  async execute<TInput, TOutput>(
    executable: Executable<TInput, TOutput>,
    input: TInput,
    context: ExecutableContext,
  ): Promise<TaskResult> {
    const result = await executable.execute(input, context);

    // Wrap result in outputs object using executable name as key
    const outputs: Record<string, any> = {
      [executable.name]: result,
    };

    return { outputs };
  }
}
