interface RuntimeProcess {
  argv?: string[];
  env?: Record<string, string | undefined>;
  exit?(code?: number): never;
  exitCode?: number;
}

const runtimeProcess = (globalThis as typeof globalThis & { process?: RuntimeProcess }).process;

export const argv = runtimeProcess?.argv ?? [];
export const env = runtimeProcess?.env ?? {};

export function requiredEnv(name: string): string {
  const value = env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export function exit(code = 0): never {
  if (runtimeProcess?.exit) runtimeProcess.exit(code);
  throw new Error(`Process exit requested with code ${code}`);
}

export function setExitCode(code: number): void {
  if (runtimeProcess) runtimeProcess.exitCode = code;
}

export function print(providerName: string, value: unknown): void {
  const details = typeof value === "object" && value !== null ? value : { value };
  console.log(JSON.stringify({ provider: providerName, ...details }, null, 2));
}
