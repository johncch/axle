import { braveWebSearch, configureAxle, type ReasoningSetting } from "@fifthrevision/axle";
import "dotenv/config";
import logUpdate from "log-update";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { inspect } from "node:util";
import { checkCases, type CheckCase, type CheckCaseResult } from "./cases/index.js";
import { resolveProviderTargets, type ProviderId, type ProviderTarget } from "./providers.js";

const REASONING_FLAGS = ["default", "off", "on", "low", "medium", "high"] as const;

interface RunOptions {
  providers: string[];
  model?: string;
  all: boolean;
  reasoning?: ReasoningSetting;
  extended: boolean;
  cases: string[];
  out: string;
}

interface CheckRecord {
  timestamp: string;
  providerId: string;
  model: string;
  reasoning?: ReasoningSetting;
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
const cases = selectCases(checkCases, options);

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

interface UsageTotals {
  in: number;
  out: number;
  cachedIn: number;
  cacheWriteIn: number;
  reasoningOut: number;
  reportingCases: number;
  runCases: number;
}

let passed = 0;
let skipped = 0;
const failedRecords: CheckRecord[] = [];
const usageTotals: UsageTotals[] = targets.map(() => ({
  in: 0,
  out: 0,
  cachedIn: 0,
  cacheWriteIn: 0,
  reasoningOut: 0,
  reportingCases: 0,
  runCases: 0,
}));
const reporter = new DotReporter(targets.length, cases.length);
const runStartedAt = Date.now();

console.log(bar("checks session starts"));
const groupLabel =
  options.cases.length > 0 ? "selected" : options.extended ? "default + extended" : "default";
console.log(`collected ${cases.length} cases (${groupLabel}), ${targets.length} providers\n`);

await Promise.all(targets.map((target, index) => runTarget(target, index)));

async function runTarget(target: ProviderTarget, index: number): Promise<void> {
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
        reasoning: options.reasoning,
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
        requestOptions: options.reasoning ? { reasoning: options.reasoning } : {},
      });
      accumulateUsage(usageTotals[index], result.details?.usage);
      const usageViolation = findUsageInvariantViolation(result.details?.usage);
      const failureReasons = deriveFailureReasons(result, usageViolation);
      const status = result.ok && failureReasons.length === 0 ? "pass" : "fail";
      if (status === "pass") passed += 1;

      const record: CheckRecord = {
        timestamp: new Date().toISOString(),
        providerId: target.id,
        model: target.model,
        reasoning: options.reasoning,
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
      usageTotals[index].runCases += 1;
      const serializedError = serializeError(error);
      const failureReasons = [`Case threw: ${getErrorMessage(error) ?? "unknown error"}`];
      const record: CheckRecord = {
        timestamp: new Date().toISOString(),
        providerId: target.id,
        model: target.model,
        reasoning: options.reasoning,
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

console.log(`\n${bar("TOKENS")}`);
const tokenLabelWidth = Math.max(...targets.map((target) => `${target.id}:${target.model}`.length));
for (const [index, target] of targets.entries()) {
  const totals = usageTotals[index];
  const label = `${target.id}:${target.model}`.padEnd(tokenLabelWidth);
  const cacheNote =
    totals.cachedIn > 0 || totals.cacheWriteIn > 0
      ? ` (cached ${formatTokens(totals.cachedIn)}, cache write ${formatTokens(totals.cacheWriteIn)})`
      : "";
  const reasoningNote =
    totals.reasoningOut > 0 ? ` (reasoning ${formatTokens(totals.reasoningOut)})` : "";
  console.log(
    `${label}  in ${formatTokens(totals.in)}${cacheNote}  out ${formatTokens(totals.out)}${reasoningNote}` +
      color("gray", `  ${totals.reportingCases}/${totals.runCases} cases reported usage`),
  );
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

// Only cases that put `usage` in their details contribute, so the totals are
// a floor on spend; the reporting-case count says how complete they are.
function accumulateUsage(totals: UsageTotals, usage: unknown): void {
  totals.runCases += 1;
  if (!usage || typeof usage !== "object") return;
  const stats = usage as Record<string, unknown>;
  if (typeof stats.in !== "number" || typeof stats.out !== "number") return;
  totals.reportingCases += 1;
  totals.in += stats.in;
  totals.out += stats.out;
  totals.cachedIn += typeof stats.cachedIn === "number" ? stats.cachedIn : 0;
  totals.cacheWriteIn += typeof stats.cacheWriteIn === "number" ? stats.cacheWriteIn : 0;
  totals.reasoningOut += typeof stats.reasoningOut === "number" ? stats.reasoningOut : 0;
}

function formatTokens(value: number): string {
  return value.toLocaleString("en-US");
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
  result: CheckCaseResult,
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

// An explicit --case selection wins over the group filter so an extended
// case can be run alone without also enabling the whole extended set.
function selectCases(all: CheckCase[], selection: RunOptions): CheckCase[] {
  if (selection.cases.length > 0) {
    return all.filter((testCase) =>
      selection.cases.some((pattern) => matchesCasePattern(testCase.id, pattern)),
    );
  }
  return selection.extended ? all : all.filter((testCase) => testCase.group === "default");
}

function matchesCasePattern(id: string, pattern: string): boolean {
  if (pattern.endsWith("*")) return id.startsWith(pattern.slice(0, -1));
  return id === pattern;
}

function getSkipReason(
  testCase: CheckCase,
  providerId: ProviderId,
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

function parseReasoningFlag(value: string): ReasoningSetting {
  if (!(REASONING_FLAGS as readonly string[]).includes(value)) {
    throw new Error(`--reasoning expects one of ${REASONING_FLAGS.join(", ")}`);
  }
  if (value === "low" || value === "medium" || value === "high") return { effort: value };
  return value as "default" | "off" | "on";
}

function parseArgs(args: string[]): RunOptions {
  const parsed: RunOptions = {
    providers: [],
    all: false,
    extended: false,
    cases: [],
    out: join("output", "checks", `run-${Date.now()}.jsonl`),
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
      case "--reasoning":
        parsed.reasoning = parseReasoningFlag(next());
        break;
      case "--extended":
        parsed.extended = true;
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
  console.log(`Provider checks

Usage:
  pnpm exec tsx checks/run.ts [provider] [options]

Options:
  --provider <id>    Provider id. Repeat or comma-separate to run multiple providers.
  --all              Include non-default providers such as OpenRouter.
  --model <model>    Override model for one selected provider.
  --reasoning <s>    Portable reasoning setting: default, off, on, low, medium, or high.
  --extended         Run the extended case group as well as the default group.
  --case <id>        Case id or prefix ending in "*". Repeat or comma-separate.
                     Selected cases run regardless of group.
  --out <path>       JSONL output path. Defaults to output/checks/*.jsonl.
`);
}

function getEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}
