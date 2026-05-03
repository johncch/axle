import { spawn } from "node:child_process";

/**
 * Options for command execution.
 */
export interface ExecOptions {
  /** Working directory for the command */
  cwd?: string;
  /** Timeout in milliseconds (default: 30000) */
  timeout?: number;
  /** Maximum buffer size for stdout/stderr combined (default: 1MB) */
  maxBuffer?: number;
  /** AbortSignal — kills the process when triggered */
  signal?: AbortSignal;
  /**
   * Optional callback fired for each stdout/stderr chunk as it arrives.
   * Chunks are emitted in arrival order; stdout and stderr are interleaved.
   */
  onChunk?: (chunk: string) => void;
}

/**
 * Result of command execution.
 */
export interface ExecResult {
  stdout: string;
  stderr: string;
}

const DEFAULT_TIMEOUT = 30000;
const DEFAULT_MAX_BUFFER = 1024 * 1024;

/**
 * Executes a shell command with the given options.
 *
 * @param command - The shell command to execute
 * @param options - Execution options (cwd, timeout, maxBuffer, signal, onChunk)
 * @returns Promise resolving to ExecResult with stdout and stderr
 * @throws Error if command fails, times out, is aborted, or exceeds maxBuffer
 */
export async function runCommand(command: string, options: ExecOptions = {}): Promise<ExecResult> {
  const timeout = options.timeout ?? DEFAULT_TIMEOUT;
  const maxBuffer = options.maxBuffer ?? DEFAULT_MAX_BUFFER;

  return new Promise<ExecResult>((resolve, reject) => {
    const child = spawn(command, [], { shell: true, cwd: options.cwd });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let aborted = false;
    let bufferExceeded = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeout);

    const onAbort = () => {
      aborted = true;
      child.kill("SIGTERM");
    };
    options.signal?.addEventListener("abort", onAbort);

    const cleanup = () => {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
    };

    child.stdout?.setEncoding("utf-8");
    child.stderr?.setEncoding("utf-8");

    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
      if (stdout.length + stderr.length > maxBuffer) {
        bufferExceeded = true;
        child.kill("SIGTERM");
        return;
      }
      options.onChunk?.(chunk);
    });

    child.stderr?.on("data", (chunk: string) => {
      stderr += chunk;
      if (stdout.length + stderr.length > maxBuffer) {
        bufferExceeded = true;
        child.kill("SIGTERM");
        return;
      }
      options.onChunk?.(chunk);
    });

    child.on("error", (err) => {
      cleanup();
      reject(err);
    });

    child.on("close", (code) => {
      cleanup();

      if (timedOut) {
        const err = new Error(`Command timed out after ${timeout}ms`) as Error & {
          stdout?: string;
          stderr?: string;
        };
        err.stdout = stdout;
        err.stderr = stderr;
        reject(err);
        return;
      }

      if (aborted) {
        const err = new Error("Command aborted") as Error & {
          stdout?: string;
          stderr?: string;
        };
        err.stdout = stdout;
        err.stderr = stderr;
        reject(err);
        return;
      }

      if (bufferExceeded) {
        const err = new Error(`Command output exceeded maxBuffer (${maxBuffer} bytes)`) as Error & {
          stdout?: string;
          stderr?: string;
        };
        err.stdout = stdout;
        err.stderr = stderr;
        reject(err);
        return;
      }

      if (code !== 0) {
        const err = new Error(`Command failed with exit code ${code}`) as Error & {
          stdout?: string;
          stderr?: string;
          code?: number;
        };
        err.stdout = stdout;
        err.stderr = stderr;
        err.code = code ?? -1;
        reject(err);
        return;
      }

      resolve({ stdout, stderr });
    });
  });
}

/**
 * Formats an exec error into a human-readable string.
 * Includes stdout and stderr from the error if available.
 */
export function formatExecError(error: unknown): string {
  if (error instanceof Error) {
    const execError = error as Error & { stdout?: string; stderr?: string; code?: number };
    let message = `Error executing command: ${error.message}`;
    if (execError.stdout) {
      message += `\n[stdout]: ${execError.stdout}`;
    }
    if (execError.stderr) {
      message += `\n[stderr]: ${execError.stderr}`;
    }
    return message;
  }
  return `Error executing command: ${String(error)}`;
}

/**
 * Formats command output, including stderr if present.
 */
export function formatOutput(stdout: string, stderr: string): string {
  if (stderr && stderr.trim()) {
    return `${stdout}\n[stderr]: ${stderr}`;
  }
  return stdout;
}
