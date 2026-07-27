import { braveWebSearch, configureAxle } from "@fifthrevision/axle";
import "dotenv/config";
import logUpdate from "log-update";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { inspect } from "node:util";
import { baselineCases, type BaselineCase, type BaselineCaseResult } from "./cases.js";
import {
  resolveProviderTargets,
  type BaselineProviderId,
  type BaselineProviderTarget,
} from "./providers.js";

interface RunOptions {
  providers: string[];
  model?: string;
  all: boolean;
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
    ? baselineCases
    : baselineCases.filter((testCase) => options.cases.includes(testCase.id));

if (cases.length === 0) {
  throw new Error(`No cases matched: ${options.cases.join(", ")}`);
}

configureAxle({
  webSearchFallback: braveWebSearch({ apiKey: getEnv("BRAVE_API_KEY") }),
});

await mkdir(dirname(options.out), { recursive: true });
await writeFile(options.out, "");

// Providers run concurrently and render pytest-style: one dot row per
// provider (`.` pass, `F` fail, `E` error, `s` skip) with right-aligned
// progress. On a TTY all rows update live via log-update; without one
// (piped/CI), each provider's completed row prints when it finishes.
class DotReporter {
  private labels: string[];
  private glyphs: string[][];
  private finished: boolean[];
  private readonly tty = process.stdout.isTTY === true;

  constructor(
    count: number,
    private readonly casesPerProvider: number,
  ) {
    this.labels = Array.from({ length: count }, () => "");
    this.glyphs = Array.from({ length: count }, () => []);
    this.finished = Array.from({ length: count }, () => false);
  }

  start(index: number, label: string): void {
    this.labels[index] = label;
    if (this.tty) this.render();
  }

  caseDone(index: number, status: CheckRecord["status"]): void {
    this.glyphs[index].push(glyphFor(status));
    if (this.tty) this.render();
  }

  finish(index: number): void {
    this.finished[index] = true;
    if (!this.tty) {
      console.log(this.row(index));
      return;
    }
    this.render();
    if (this.finished.every(Boolean)) logUpdate.done();
  }

  private render(): void {
    logUpdate(this.labels.map((_, index) => this.row(index)).join("\n"));
  }

  private row(index: number): string {
    const label = this.labels[index];
    const dots = this.glyphs[index].join("");
    const done = this.glyphs[index].length;
    const percent = `[${String(Math.round((done / this.casesPerProvider) * 100)).padStart(3)}%]`;
    const width = process.stdout.columns ?? 100;
    const visibleLength = label.length + 1 + done;
    const pad = Math.max(1, width - 1 - visibleLength - percent.length);
    return `${label} ${dots}${" ".repeat(pad)}${percent}`;
  }
}

function glyphFor(status: CheckRecord["status"]): string {
  if (status === "pass") return color("green", ".");
  if (status === "skip") return color("yellow", "s");
  return color("red", status === "fail" ? "F" : "E");
}

function bar(text: string): string {
  const width = process.stdout.columns ?? 80;
  const inner = ` ${text} `;
  const fill = Math.max(4, width - inner.length);
  const left = Math.floor(fill / 2);
  return `${"=".repeat(left)}${inner}${"=".repeat(fill - left)}`;
}

let passed = 0;
let skipped = 0;
const failedRecords: CheckRecord[] = [];
const reporter = new DotReporter(targets.length, cases.length);
const runStartedAt = Date.now();

console.log(bar("baseline session starts"));
console.log(`collected ${cases.length} cases, ${targets.length} providers\n`);

await Promise.all(targets.map((target, index) => runTarget(target, index)));

async function runTarget(target: BaselineProviderTarget, index: number): Promise<void> {
  reporter.start(index, `${target.id}:${target.model}`);
  const provider = target.createProvider();

  for (const testCase of cases) {
    const skipReason = getSkipReason(testCase, target.id, target.model);
    if (skipReason) {
      skipped += 1;
      await writeRecord({
        timestamp: new Date().toISOString(),
        providerId: target.id,
        model: target.model,
        thinking: options.thinking,
        caseId: testCase.id,
        caseDescription: testCase.description,
        status: "skip",
        durationMs: 0,
        skipReason,
      });
      reporter.caseDone(index, "skip");
      continue;
    }

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
      reporter.caseDone(index, status);
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
      reporter.caseDone(index, "error");
    }
  }

  reporter.finish(index);
}

if (failedRecords.length > 0) {
  console.log(`\n${bar("FAILURES")}`);
  for (const record of failedRecords) {
    console.log(
      `\n${formatStatus(record.status)} ${record.providerId}:${record.model} ${record.caseId}`,
    );
    if (record.failureReasons && record.failureReasons.length > 0) {
      console.log(formatFailureReasons(record.failureReasons));
    }
    console.log(formatDetails(record.details ?? record.error));
  }
}

const failCount = failedRecords.filter((record) => record.status === "fail").length;
const errorCount = failedRecords.filter((record) => record.status === "error").length;
const summaryParts = [
  ...(failCount > 0 ? [`${failCount} failed`] : []),
  `${passed} passed`,
  ...(skipped > 0 ? [`${skipped} skipped`] : []),
  ...(errorCount > 0 ? [`${errorCount} errors`] : []),
];
const elapsed = ((Date.now() - runStartedAt) / 1000).toFixed(2);
const summaryColor = failedRecords.length > 0 ? "red" : "green";
console.log(`\n${color(summaryColor, bar(`${summaryParts.join(", ")} in ${elapsed}s`))}`);
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
  if (status === "skip") return color("gray", "- skip");
  if (status === "fail") return color("red", "✗ fail");
  return color("red", "✗ error");
}

function color(colorName: "green" | "red" | "yellow" | "gray", value: string): string {
  const code =
    colorName === "green" ? 32 : colorName === "red" ? 31 : colorName === "yellow" ? 33 : 90;
  return `\x1b[${code}m${value}\x1b[0m`;
}

function getSkipReason(
  testCase: BaselineCase,
  providerId: BaselineProviderId,
  model: string,
): string | undefined {
  if (testCase.providers && !testCase.providers.includes(providerId)) {
    return `Case is not enabled for provider ${providerId}.`;
  }

  return testCase.exclusions?.find(
    (exclusion) =>
      exclusion.provider === providerId &&
      (exclusion.model === undefined || exclusion.model.test(model)),
  )?.reason;
}

function formatDetails(value: unknown): string {
  return inspect(value, { colors: true, depth: 8, compact: false })
    .split("\n")
    .map((line) => `    ${line}`)
    .join("\n");
}

function formatFailureReasons(reasons: string[]): string {
  return reasons.map((reason) => `    Reason: ${reason}`).join("\n");
}

function parseArgs(args: string[]): RunOptions {
  const parsed: RunOptions = {
    providers: [],
    all: false,
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
        parsed.providers.push(...splitList(next()));
        break;
      case "--all":
        parsed.all = true;
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
          parsed.providers.push(...splitList(arg));
          break;
        }
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (parsed.providers.length > 0 && parsed.all) {
    throw new Error("Cannot specify both --provider and --all");
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
  --provider <id>    Provider id. Repeat or comma-separate to run multiple providers.
  --all              Include non-default providers such as OpenRouter.
  --model <model>    Override model for one selected provider.
  --thinking         Enable provider reasoning/thinking controls where supported.
  --case <id>        Case id. Repeat or comma-separate. Defaults to all cases.
  --out <path>       JSONL output path. Defaults to output/checks/*.jsonl.
`);
}

function getEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}
