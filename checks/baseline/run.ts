import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { inspect } from "node:util";
import { baselineCases, type BaselineCaseResult } from "./cases.js";
import { resolveProviderTargets } from "./providers.js";

interface RunOptions {
  provider?: string;
  model?: string;
  thinking: boolean;
  cases: string[];
  out: string;
}

interface CheckRecord {
  timestamp: string;
  providerId: string;
  model: string;
  thinking: boolean;
  caseId: string;
  caseDescription: string;
  status: "pass" | "fail" | "error";
  durationMs: number;
  failureReasons?: string[];
  details?: Record<string, unknown>;
  error?: unknown;
}

const options = parseArgs(process.argv.slice(2));
const targets = resolveProviderTargets({ provider: options.provider, model: options.model });
const cases =
  options.cases.length === 0
    ? baselineCases
    : baselineCases.filter((testCase) => options.cases.includes(testCase.id));

if (cases.length === 0) {
  throw new Error(`No cases matched: ${options.cases.join(", ")}`);
}

await mkdir(dirname(options.out), { recursive: true });
await writeFile(options.out, "");

let passed = 0;
let total = 0;
const failedRecords: CheckRecord[] = [];

for (const target of targets) {
  console.log(`[Provider] ${target.id}:${target.model}`);
  const provider = target.createProvider();

  for (const testCase of cases) {
    if (testCase.providers && !testCase.providers.includes(target.id)) continue;

    total += 1;
    const startedAt = Date.now();

    try {
      const result = await testCase.run({
        provider,
        model: target.model,
        providerId: target.id,
        requestOptions: options.thinking ? { reasoning: true } : {},
      });
      const usageViolation = findUsageInvariantViolation(result.details?.usage);
      const failureReasons = deriveFailureReasons(result, usageViolation);
      const status = result.ok && failureReasons.length === 0 ? "pass" : "fail";
      if (status === "pass") passed += 1;

      const record: CheckRecord = {
        timestamp: new Date().toISOString(),
        providerId: target.id,
        model: target.model,
        thinking: options.thinking,
        caseId: testCase.id,
        caseDescription: testCase.description,
        status,
        durationMs: Date.now() - startedAt,
        ...(failureReasons.length > 0 ? { failureReasons } : {}),
        details: usageViolation ? { ...result.details, usageViolation } : result.details,
      };
      await writeRecord(record);
      if (status !== "pass") failedRecords.push(record);
      console.log(
        `  ${formatStatus(status)} [${testCase.id}]${formatInlineFailureReasons(failureReasons)}`,
      );
    } catch (error) {
      const serializedError = serializeError(error);
      const failureReasons = [`Case threw: ${getErrorMessage(error) ?? "unknown error"}`];
      const record: CheckRecord = {
        timestamp: new Date().toISOString(),
        providerId: target.id,
        model: target.model,
        thinking: options.thinking,
        caseId: testCase.id,
        caseDescription: testCase.description,
        status: "error",
        durationMs: Date.now() - startedAt,
        failureReasons,
        error: serializedError,
      };
      await writeRecord(record);
      failedRecords.push(record);
      console.log(
        `  ${formatStatus("error")} [${testCase.id}]${formatInlineFailureReasons(failureReasons)}`,
      );
    }
  }
}

const rate = total === 0 ? 0 : (passed / total) * 100;
console.log(`\n[Summary] ${passed}/${total} passed (${rate.toFixed(1)}%)`);
if (failedRecords.length > 0) {
  console.log("\n[Failures]");
  for (const record of failedRecords) {
    console.log(
      `${formatStatus(record.status)} ${record.providerId}:${record.model} ${record.caseId}`,
    );
    if (record.failureReasons && record.failureReasons.length > 0) {
      console.log(formatFailureReasons(record.failureReasons));
    }
    console.log(formatDetails(record.details ?? record.error));
  }
}
console.log(`[Output] ${options.out}`);

if (failedRecords.length > 0) process.exitCode = 1;

async function writeRecord(record: CheckRecord): Promise<void> {
  await writeFile(options.out, `${JSON.stringify(record)}\n`, { flag: "a" });
}

// Every accumulation path attributes usage to a provider+model entry, so
// breakdown entries must sum exactly to the aggregate fields; drift means
// tokens were dropped or double-counted somewhere in the pipeline.
function findUsageInvariantViolation(usage: unknown): string | undefined {
  if (!usage || typeof usage !== "object") return undefined;
  const stats = usage as Record<string, unknown>;
  const breakdown = stats.breakdown;
  if (!Array.isArray(breakdown) || breakdown.length === 0) return undefined;

  const fields = ["in", "out", "cachedIn", "cacheWriteIn", "reasoningOut"] as const;
  for (const field of fields) {
    const total = typeof stats[field] === "number" ? (stats[field] as number) : 0;
    const sum = breakdown.reduce((acc: number, entry: Record<string, unknown>) => {
      return acc + (typeof entry[field] === "number" ? (entry[field] as number) : 0);
    }, 0);
    if (sum !== total) {
      return `usage.${field} is ${total} but breakdown entries sum to ${sum}`;
    }
  }
  return undefined;
}

function deriveFailureReasons(
  result: BaselineCaseResult,
  usageViolation: string | undefined,
): string[] {
  const reasons = [...(result.failureReasons ?? []), ...(usageViolation ? [usageViolation] : [])];
  if (result.ok || reasons.length > 0) return reasons;

  const errorMessage = getErrorMessage(result.details?.error);
  if (errorMessage) return [`Model or workflow error: ${errorMessage}`];
  return ["Case returned ok: false without a diagnostic reason."];
}

function formatStatus(status: CheckRecord["status"]): string {
  if (status === "pass") return color("green", "✓ pass");
  if (status === "fail") return color("red", "✗ fail");
  return color("red", "✗ error");
}

function color(colorName: "green" | "red", value: string): string {
  const code = colorName === "green" ? 32 : 31;
  return `\x1b[${code}m${value}\x1b[0m`;
}

function formatDetails(value: unknown): string {
  return inspect(value, { colors: true, depth: 8, compact: false })
    .split("\n")
    .map((line) => `    ${line}`)
    .join("\n");
}

function formatInlineFailureReasons(reasons: string[]): string {
  if (reasons.length === 0) return "";
  return `: ${reasons.join(" ")}`;
}

function formatFailureReasons(reasons: string[]): string {
  return reasons.map((reason) => `    Reason: ${reason}`).join("\n");
}

function parseArgs(args: string[]): RunOptions {
  const parsed: RunOptions = {
    thinking: false,
    cases: [],
    out: join("output", "checks", `baseline-${Date.now()}.jsonl`),
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = () => {
      const value = args[++i];
      if (!value) throw new Error(`Missing value for ${arg}`);
      return value;
    };

    switch (arg) {
      case "--provider":
        parsed.provider = next();
        break;
      case "--model":
        parsed.model = next();
        break;
      case "--case":
      case "--cases":
        parsed.cases.push(...splitList(next()));
        break;
      case "--out":
        parsed.out = next();
        break;
      case "--thinking":
        parsed.thinking = true;
        break;
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
      default:
        if (!arg.startsWith("-")) {
          parsed.provider = arg;
          break;
        }
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return parsed;
}

function splitList(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function serializeError(error: unknown): unknown {
  if (error instanceof Error) {
    return { name: error.name, message: error.message, stack: error.stack };
  }
  return error;
}

function getErrorMessage(error: unknown): string | undefined {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  if (!error || typeof error !== "object") {
    return typeof error === "string" ? error : undefined;
  }

  const record = error as Record<string, unknown>;
  if (typeof record.message === "string") return record.message;
  if ("error" in record) return getErrorMessage(record.error);
  return undefined;
}

function printHelp(): void {
  console.log(`Baseline provider checks

Usage:
  pnpm exec tsx checks/baseline/run.ts [provider] [options]

Options:
  --provider <id>    Provider id: openai, anthropic, gemini, openrouter.
  --model <model>    Override model for the selected provider. Requires --provider.
  --thinking         Enable provider reasoning/thinking controls where supported.
  --case <id>        Case id. Repeat or comma-separate. Defaults to all cases.
  --out <path>       JSONL output path. Defaults to output/checks/*.jsonl.
`);
}
