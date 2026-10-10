import type { ReasoningSetting } from "@fifthrevision/axle";
import "dotenv/config";
import logUpdate from "log-update";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { inspect } from "node:util";
import {
  checkCases,
  type AnyCheckCase,
  type CheckCase,
  type CheckCaseResult,
  type DecisionCheckCase,
} from "./cases/index.js";
import {
  LEDGER_PATH,
  readAxleRevision,
  readLedger,
  recordLedgerRuns,
  type LedgerEntry,
} from "./ledger.js";
import {
  providerTargets,
  resolveProviderTargets,
  type ProviderId,
  type ProviderTarget,
} from "./providers.js";

const REASONING_FLAGS = ["default", "off", "on", "low", "medium", "high"] as const;

interface RunOptions {
  providers: string[];
  model?: string;
  all: boolean;
  reasoning?: ReasoningSetting;
  extended: boolean;
  cases: string[];
  out: string;
  record: boolean;
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

if (process.argv[2] === "ledger") {
  await printLedger();
  process.exit(0);
}

const options = parseArgs(process.argv.slice(2));
const cases = selectCases(checkCases, options);

if (cases.length === 0) {
  throw new Error(`No cases matched: ${options.cases.join(", ")}`);
}

const targets = resolveProviderTargets({
  providers: options.providers,
  model: options.model,
  all: options.all,
}).filter((target) => casesOfKind(target.kind).length > 0);

if (targets.length === 0) {
  throw new Error("None of the selected cases apply to the selected providers");
}

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

  constructor(private readonly casesPerProvider: number[]) {
    this.labels = casesPerProvider.map(() => "");
    this.glyphs = casesPerProvider.map(() => []);
    this.finished = casesPerProvider.map(() => false);
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
    const percent = `[${String(Math.round((done / this.casesPerProvider[index]) * 100)).padStart(3)}%]`;
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

type LedgerCell = CheckRecord["status"] | "not-applicable" | "unrecorded";

function ledgerCell(entry: LedgerEntry, testCase: AnyCheckCase): LedgerCell {
  const target = providerTargets.find((candidate) => candidate.id === entry.provider);
  if ((target?.kind ?? "chat") !== caseKind(testCase)) return "not-applicable";
  if (testCase.providers && !testCase.providers.includes(entry.provider as ProviderId)) {
    return "not-applicable";
  }
  return entry.cases[testCase.id]?.status ?? "unrecorded";
}

function ledgerGlyph(cell: LedgerCell): string {
  if (cell === "not-applicable") return color("gray", "-");
  if (cell === "unrecorded") return " ";
  return glyphFor(cell);
}

function needsAttention(cell: LedgerCell): boolean {
  return cell === "fail" || cell === "error" || cell === "skip";
}

async function printLedger(): Promise<void> {
  const entries = await readLedger();
  if (entries.length === 0) {
    console.log(`No recorded runs in ${LEDGER_PATH}.`);
    return;
  }

  const labels = entries.map((entry) => `${entry.provider}:${entry.model}`);
  const labelWidth = Math.max(...labels.map((label) => label.length));
  const columnWidth = String(entries.length).length + 1;

  const tallies = entries.map((entry) => {
    const cells = checkCases.map((testCase) => ledgerCell(entry, testCase));
    const count = (cell: LedgerCell) => cells.filter((candidate) => candidate === cell).length;
    return {
      passed: count("pass"),
      failed: count("fail") + count("error"),
      modelSkipped: count("skip"),
      providerSkipped: count("not-applicable"),
      notRun: count("unrecorded"),
    };
  });
  const tallyWidth = (key: keyof (typeof tallies)[number]) =>
    Math.max(...tallies.map((tally) => String(tally[key]).length));
  const tallyCell = (
    value: number,
    letter: string,
    width: number,
    tint: "green" | "red" | "yellow" | "gray",
  ) => color(value > 0 ? tint : "gray", `${String(value).padStart(width)}${letter}`);

  console.log(bar("checks ledger"));
  for (const [index, entry] of entries.entries()) {
    const tally = tallies[index];
    const summary = [
      tallyCell(tally.passed, "P", tallyWidth("passed"), "green"),
      tallyCell(tally.failed, "F", tallyWidth("failed"), "red"),
      tallyCell(tally.modelSkipped, "ms", tallyWidth("modelSkipped"), "yellow"),
      tallyCell(tally.providerSkipped, "ps", tallyWidth("providerSkipped"), "gray"),
      tallyCell(tally.notRun, "N", tallyWidth("notRun"), "gray"),
    ].join(" ");
    const commits = new Set(Object.values(entry.cases).map((ledgerCase) => ledgerCase.commit));
    const revision =
      commits.size === 1 ? [...commits][0] : `${commits.size} commits, latest ${entry.axle.commit}`;
    console.log(
      `${String(index + 1).padStart(columnWidth)}  ${labels[index].padEnd(labelWidth)}  ${summary}` +
        color("gray", `  ${entry.recordedAt.slice(0, 10)}  ${revision}`),
    );
  }

  const attentionCases = checkCases.filter((testCase) =>
    entries.some((entry) => needsAttention(ledgerCell(entry, testCase))),
  );
  if (attentionCases.length === 0) {
    console.log(`\n${color("green", "Every recorded case passes on every model.")}`);
    return;
  }

  const caseWidth = Math.max(...attentionCases.map((testCase) => testCase.id.length));
  console.log(
    `\n${" ".repeat(caseWidth)} ${entries.map((_, index) => String(index + 1).padStart(columnWidth)).join("")}`,
  );
  for (const testCase of attentionCases) {
    const row = entries
      .map((entry) => `${" ".repeat(columnWidth - 1)}${ledgerGlyph(ledgerCell(entry, testCase))}`)
      .join("");
    console.log(`${testCase.id.padEnd(caseWidth)} ${row}`);
  }
  console.log(
    color("gray", "\n. pass  F fail  E error  s model skip (ms)  - provider skip (ps)  N not run"),
  );

  for (const [index, entry] of entries.entries()) {
    const attention = attentionCases.filter((testCase) =>
      needsAttention(ledgerCell(entry, testCase)),
    );
    if (attention.length === 0) continue;
    console.log(`\n${labels[index]}`);
    for (const testCase of attention) {
      const ledgerCase = entry.cases[testCase.id];
      const reason = (ledgerCase.reasons?.[0] ?? "").replace(/\s+/g, " ");
      console.log(`  ${glyphFor(ledgerCase.status)} ${testCase.id}  ${reason}`);
    }
  }
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
const records: CheckRecord[] = [];
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
const reporter = new DotReporter(targets.map((target) => casesOfKind(target.kind).length));
const runStartedAt = Date.now();

console.log(bar("checks session starts"));
const groupLabel =
  options.cases.length > 0 ? "selected" : options.extended ? "default + extended" : "default";
console.log(`collected ${cases.length} cases (${groupLabel}), ${targets.length} providers\n`);

await Promise.all(targets.map((target, index) => runTarget(target, index)));

async function runTarget(target: ProviderTarget, index: number): Promise<void> {
  reporter.start(index, `${target.id}:${target.model}`);
  for (const { testCase, run } of bindCases(target)) {
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
      const result = await run();
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

if (options.record) {
  const axle = await readAxleRevision();
  await recordLedgerRuns(
    targets.map((target) => ({
      model: target.model,
      provider: target.id,
      axle,
      reasoning: options.reasoning,
      records: records.filter(
        (record) => record.providerId === target.id && record.model === target.model,
      ),
    })),
    checkCases.map((testCase) => testCase.id),
  );
  console.log(`[Ledger] ${LEDGER_PATH}`);
}

if (failedRecords.length > 0) process.exitCode = 1;

async function writeRecord(record: CheckRecord): Promise<void> {
  records.push(record);
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
function caseKind(testCase: AnyCheckCase): ProviderTarget["kind"] {
  return testCase.kind ?? "chat";
}

function casesOfKind(kind: ProviderTarget["kind"]): AnyCheckCase[] {
  return cases.filter((testCase) => caseKind(testCase) === kind);
}

interface BoundCase {
  testCase: AnyCheckCase;
  run(): Promise<CheckCaseResult>;
}

function bindCases(target: ProviderTarget): BoundCase[] {
  const { id: providerId, model } = target;

  if (target.kind === "decision") {
    const provider = target.createProvider();
    return cases
      .filter((testCase): testCase is DecisionCheckCase => testCase.kind === "decision")
      .map((testCase) => ({
        testCase,
        run: () => testCase.run({ provider, model, providerId }),
      }));
  }

  const provider = target.createProvider();
  const requestOptions = options.reasoning ? { reasoning: options.reasoning } : {};
  return cases
    .filter((testCase): testCase is CheckCase => testCase.kind !== "decision")
    .map((testCase) => ({
      testCase,
      run: () => testCase.run({ provider, model, providerId, requestOptions }),
    }));
}

function selectCases(all: AnyCheckCase[], selection: RunOptions): AnyCheckCase[] {
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
  testCase: AnyCheckCase,
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
    record: true,
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
      case "--no-record":
        parsed.record = false;
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
  pnpm exec tsx checks/run.ts ledger      Show the recorded results per model.

Options:
  --provider <id>    Provider id. Repeat or comma-separate to run multiple providers.
  --all              Include non-default providers such as OpenRouter.
  --model <model>    Override model for one selected provider.
  --reasoning <s>    Portable reasoning setting: default, off, on, low, medium, or high.
  --extended         Run the extended case group as well as the default group.
  --case <id>        Case id or prefix ending in "*". Repeat or comma-separate.
                     Selected cases run regardless of group.
  --out <path>       JSONL output path. Defaults to output/checks/*.jsonl.
  --no-record        Do not merge the results into checks/ledger.jsonl. By
                     default every run updates each model's entry; cases
                     that did not run keep theirs.
`);
}
