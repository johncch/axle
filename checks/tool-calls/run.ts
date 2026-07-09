import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { inspect } from "node:util";
import {
  toolCallCases,
  type ToolCallCase,
  type ToolCallCaseResult,
  type ToolCallSurface,
} from "./cases.js";
import { resolveProviderTargets, type ToolCallProviderId } from "./providers.js";

interface RunOptions {
  providers: string[];
  model?: string;
  all: boolean;
  thinking: boolean;
  cases: string[];
  surfaces: ToolCallSurface[];
  out: string;
}

interface CheckRecord {
  timestamp: string;
  providerId: string;
  model: string;
  thinking: boolean;
  surface: ToolCallSurface;
  caseId: string;
  caseDescription: string;
  status: "pass" | "fail" | "error" | "skip";
  durationMs: number;
  skipReason?: string;
  failureReasons?: string[];
  details?: Record<string, unknown>;
  error?: unknown;
}

const options = parseArgs(process.argv.slice(2));
const targets = resolveProviderTargets({
  providers: options.providers,
  model: options.model,
  all: options.all,
});
const cases =
  options.cases.length === 0
    ? toolCallCases
    : toolCallCases.filter((testCase) => options.cases.includes(testCase.id));

if (cases.length === 0) {
  throw new Error(`No cases matched: ${options.cases.join(", ")}`);
}

await mkdir(dirname(options.out), { recursive: true });
await writeFile(options.out, "");

let passed = 0;
let total = 0;
let skipped = 0;
const failedRecords: CheckRecord[] = [];

for (const target of targets) {
  console.log(`[Provider] ${target.id}:${target.model}`);
  const provider = target.createProvider();

  for (const surface of options.surfaces) {
    console.log(`  [Surface] ${surface}`);

    for (const testCase of cases) {
      const skipReason = getSkipReason(testCase, target.id);
      if (skipReason) {
        skipped += 1;
        await writeRecord({
          timestamp: new Date().toISOString(),
          providerId: target.id,
          model: target.model,
          thinking: options.thinking,
          surface,
          caseId: testCase.id,
          caseDescription: testCase.description,
          status: "skip",
          durationMs: 0,
          skipReason,
        });
        console.log(`    ${formatStatus("skip")} [${testCase.id}]: ${skipReason}`);
        continue;
      }

      total += 1;
      const startedAt = Date.now();

      try {
        const result = await testCase.run({
          provider,
          model: target.model,
          providerId: target.id,
          requestOptions: options.thinking ? { reasoning: true } : {},
          surface,
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
          surface,
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
          `    ${formatStatus(status)} [${testCase.id}]${formatInlineFailureReasons(failureReasons)}`,
        );
      } catch (error) {
        const serializedError = serializeError(error);
        const failureReasons = [`Case threw: ${getErrorMessage(error) ?? "unknown error"}`];
        const record: CheckRecord = {
          timestamp: new Date().toISOString(),
          providerId: target.id,
          model: target.model,
          thinking: options.thinking,
          surface,
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
          `    ${formatStatus("error")} [${testCase.id}]${formatInlineFailureReasons(failureReasons)}`,
        );
      }
    }
  }
}

const rate = total === 0 ? 0 : (passed / total) * 100;
console.log(
  `\n[Summary] ${passed}/${total} passed (${rate.toFixed(1)}%)${skipped > 0 ? `, ${skipped} skipped` : ""}`,
);
if (failedRecords.length > 0) {
  console.log("\n[Failures]");
  for (const record of failedRecords) {
    console.log(
      `${formatStatus(record.status)} ${record.providerId}:${record.model} ${record.surface} ${record.caseId}`,
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

function getSkipReason(
  testCase: ToolCallCase,
  providerId: ToolCallProviderId,
): string | undefined {
  if (testCase.providers && !testCase.providers.includes(providerId)) {
    return `Case is not enabled for provider ${providerId}.`;
  }
  return undefined;
}

function deriveFailureReasons(
  result: ToolCallCaseResult,
  usageViolation: string | undefined,
): string[] {
  const reasons = [...(result.failureReasons ?? []), ...(usageViolation ? [usageViolation] : [])];
  if (result.ok || reasons.length > 0) return reasons;

  const errorMessage = getErrorMessage(result.details?.error);
  if (errorMessage) return [`Model or workflow error: ${errorMessage}`];
  return ["Case returned ok: false without a diagnostic reason."];
}

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

function parseArgs(args: string[]): RunOptions {
  const parsed: RunOptions = {
    providers: [],
    all: false,
    thinking: false,
    cases: [],
    surfaces: ["generate"],
    out: join("output", "checks", `tool-calls-${Date.now()}.jsonl`),
  };

  const next = () => {
    const value = args.shift();
    if (!value) throw new Error("Missing value for argument");
    return value;
  };

  while (args.length > 0) {
    const arg = args.shift()!;
    switch (arg) {
      case "--":
        break;
      case "--provider":
      case "-p":
        parsed.providers.push(...splitList(next()));
        break;
      case "--all":
        parsed.all = true;
        break;
      case "--model":
      case "-m":
        parsed.model = next();
        break;
      case "--thinking":
        parsed.thinking = true;
        break;
      case "--case":
      case "-c":
        parsed.cases.push(...splitList(next()));
        break;
      case "--surface":
      case "-s":
        parsed.surfaces = parseSurfaces(next());
        break;
      case "--out":
      case "-o":
        parsed.out = next();
        break;
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
      default:
        if (arg.startsWith("--provider=")) {
          parsed.providers.push(...splitList(arg.slice("--provider=".length)));
        } else if (arg.startsWith("--case=")) {
          parsed.cases.push(...splitList(arg.slice("--case=".length)));
        } else if (arg.startsWith("--surface=")) {
          parsed.surfaces = parseSurfaces(arg.slice("--surface=".length));
        } else if (arg.startsWith("--")) {
          throw new Error(`Unknown option: ${arg}`);
        } else {
          parsed.providers.push(...splitList(arg));
        }
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

function parseSurfaces(value: string): ToolCallSurface[] {
  const values = splitList(value);
  const surfaces = values.includes("both") ? ["generate", "stream"] : values;
  for (const surface of surfaces) {
    if (surface !== "generate" && surface !== "stream") {
      throw new Error(`Unknown surface: ${surface}. Expected generate, stream, or both.`);
    }
  }
  return [...new Set(surfaces)] as ToolCallSurface[];
}

function formatStatus(status: CheckRecord["status"]): string {
  if (status === "pass") return color("green", "✓ pass");
  if (status === "skip") return color("gray", "- skip");
  if (status === "fail") return color("red", "✗ fail");
  return color("red", "✗ error");
}

function color(colorName: "green" | "red" | "gray", value: string): string {
  const code = colorName === "green" ? 32 : colorName === "red" ? 31 : 90;
  return `\x1b[${code}m${value}\x1b[0m`;
}

function formatInlineFailureReasons(reasons: string[]): string {
  return reasons.length > 0 ? ` ${reasons.join("; ")}` : "";
}

function formatFailureReasons(reasons: string[]): string {
  return reasons.map((reason) => `  - ${reason}`).join("\n");
}

function formatDetails(details: unknown): string {
  return inspect(details, { depth: 8, colors: true, compact: false });
}

function serializeError(error: unknown): unknown {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      cause: error.cause,
    };
  }
  return error;
}

function getErrorMessage(error: unknown): string | undefined {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    return typeof message === "string" ? message : undefined;
  }
  return undefined;
}

function printHelp() {
  console.log(`Tool-call parameter checks

Usage:
  pnpm exec tsx checks/tool-calls/run.ts [provider] [options]

Options:
  --provider <id>    Provider id. Repeat or comma-separate to run multiple providers.
  --all              Include all configured providers. This is the default.
  --model <model>    Override model for one selected provider.
  --thinking         Enable provider reasoning/thinking controls where supported.
  --case <id>        Case id. Repeat or comma-separate. Defaults to all cases.
  --surface <name>   generate, stream, or both. Defaults to generate.
  --out <path>       JSONL output path. Defaults to output/checks/*.jsonl.
`);
}
