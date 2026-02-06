import { exec as execCb } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(execCb);

/**
 * Options for command execution.
 */
export interface ExecOptions {
  /** Working directory for the command */
  cwd?: string;
  /** Timeout in milliseconds (default: 30000) */
  timeout?: number;
  /** Maximum buffer size for stdout/stderr (default: 1MB) */
  maxBuffer?: number;
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
 * @param options - Execution options (cwd, timeout, maxBuffer)
 * @returns Promise resolving to ExecResult with stdout and stderr
 * @throws Error if command fails
 */
export async function runCommand(command: string, options: ExecOptions = {}): Promise<ExecResult> {
  const { stdout, stderr } = await execAsync(command, {
    cwd: options.cwd,
    timeout: options.timeout ?? DEFAULT_TIMEOUT,
    maxBuffer: options.maxBuffer ?? DEFAULT_MAX_BUFFER,
  });

  return { stdout, stderr };
}

/**
 * Formats an exec error into a human-readable string.
 * Includes stdout and stderr from the error if available.
 *
 * @param error - The error to format
 * @returns Formatted error message
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
 *
 * @param stdout - Standard output from the command
 * @param stderr - Standard error from the command
 * @returns Formatted output string
 */
export function formatOutput(stdout: string, stderr: string): string {
  if (stderr && stderr.trim()) {
    return `${stdout}\n[stderr]: ${stderr}`;
  }
  return stdout;
}
