import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { inspect } from "node:util";
import { Instruct, generate } from "../../src/index.js";
import { structuredOutputCases } from "./cases.js";
import { createStructuredOutputProvider, resolveStructuredOutputTargets } from "./providers.js";

interface RunOptions {
  targets: string[];
  cases: string[];
  repeats: number;
  out: string;
}

interface StructuredOutputRecord {
  timestamp: string;
  outputFormat: "json";
  targetId: string;
  provider: string;
  model: string;
  caseId: string;
  caseDescription: string;
  repeat: number;
  status: "success" | "parse-error" | "model-error" | "exception";
  durationMs: number;
  usage?: { in?: number; out?: number };
  rawText?: string;
  parsed?: unknown;
  error?: unknown;
}

const options = parseArgs(process.argv.slice(2));
const targets = resolveStructuredOutputTargets(options.targets);
const cases =
  options.cases.length === 0
    ? structuredOutputCases
    : structuredOutputCases.filter((testCase) => options.cases.includes(testCase.id));

if (cases.length === 0) {
  throw new Error(`No structured-output cases matched: ${options.cases.join(", ")}`);
}

await mkdir(dirname(options.out), { recursive: true });
await writeFile(options.out, "");

let passed = 0;
let total = 0;
const failedRecords: StructuredOutputRecord[] = [];

for (const target of targets) {
  console.log(`[Target] ${target.provider}:${target.model}`);
  const provider = createStructuredOutputProvider(target);

  for (const testCase of cases) {
    for (let repeat = 1; repeat <= options.repeats; repeat++) {
      total += 1;
      const startedAt = Date.now();
      const recordBase = {
        timestamp: new Date().toISOString(),
        outputFormat: "json" as const,
        targetId: target.id,
        provider: target.provider,
        model: target.model,
        caseId: testCase.id,
        caseDescription: testCase.description,
        repeat,
      };

      try {
        const instruct = new Instruct(testCase.prompt, testCase.schema);
        const result = await generate({
          provider,
          model: target.model,
          instruct,
        });

        const durationMs = Date.now() - startedAt;
        if (result.result === "error") {
          const record: StructuredOutputRecord = {
            ...recordBase,
            status: "model-error",
            durationMs,
            usage: result.usage,
            error: result.error,
          };
          await writeRecord(record);
          failedRecords.push(record);
          console.log(`  ${formatStatus(record.status)} [${testCase.id}] ${formatRepeat(repeat)}`);
          continue;
        }

        if (result.parseError) {
          const record: StructuredOutputRecord = {
            ...recordBase,
            status: "parse-error",
            durationMs,
            usage: result.usage,
            rawText: getRawText(result.final?.content),
            error: serializeError(result.parseError),
          };
          await writeRecord(record);
          failedRecords.push(record);
          console.log(`  ${formatStatus(record.status)} [${testCase.id}] ${formatRepeat(repeat)}`);
          continue;
        }

        const record: StructuredOutputRecord = {
          ...recordBase,
          status: "success",
          durationMs,
          usage: result.usage,
          rawText: getRawText(result.final?.content),
          parsed: result.response,
        };
        await writeRecord(record);
        passed += 1;
        console.log(`  ${formatStatus(record.status)} [${testCase.id}] ${formatRepeat(repeat)}`);
      } catch (error) {
        const record: StructuredOutputRecord = {
          ...recordBase,
          status: "exception",
          durationMs: Date.now() - startedAt,
          error: serializeError(error),
        };
        await writeRecord(record);
        failedRecords.push(record);
        console.log(`  ${formatStatus(record.status)} [${testCase.id}] ${formatRepeat(repeat)}`);
      }
    }
  }
}

const rate = total === 0 ? 0 : (passed / total) * 100;
console.log(`\n[Summary] ${passed}/${total} passed (${rate.toFixed(1)}%)`);
if (failedRecords.length > 0) {
  console.log("\n[Failures]");
  for (const record of failedRecords) {
    console.log(
      `${formatStatus(record.status)} ${record.targetId} ${record.provider}:${record.model} ${record.caseId}${formatRepeat(record.repeat)}`,
    );
    console.log(formatDetails(getFailureDetails(record)));
  }
}
console.log(`[Output] ${options.out}`);

if (passed !== total) process.exitCode = 1;

async function writeRecord(record: StructuredOutputRecord): Promise<void> {
  await writeFile(options.out, `${JSON.stringify(record)}\n`, { flag: "a" });
}

function formatStatus(status: StructuredOutputRecord["status"]): string {
  if (status === "success") return color("green", "✓ pass");
  if (status === "parse-error") return color("red", "✗ fail");
  return color("red", "✗ error");
}

function formatRepeat(repeat: number): string {
  return options.repeats > 1 ? ` ${repeat}/${options.repeats}` : "";
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

function getFailureDetails(record: StructuredOutputRecord): Record<string, unknown> {
  return {
    status: record.status,
    durationMs: record.durationMs,
    usage: record.usage,
    rawText: record.rawText,
    parsed: record.parsed,
    error: record.error,
  };
}

function getRawText(
  content: Array<{ type: string; text?: string }> | undefined,
): string | undefined {
  if (!content) return undefined;
  return content
    .filter((part) => part.type === "text")
    .map((part) => part.text ?? "")
    .join("\n\n");
}

function serializeError(error: unknown): unknown {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }
  return error;
}

function parseArgs(args: string[]): RunOptions {
  const parsed: RunOptions = {
    targets: [],
    cases: [],
    repeats: 1,
    out: join("output", "checks", `structured-output-${Date.now()}.jsonl`),
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = () => {
      const value = args[++i];
      if (!value) throw new Error(`Missing value for ${arg}`);
      return value;
    };

    switch (arg) {
      case "--target":
      case "--targets":
        parsed.targets.push(...splitList(next()));
        break;
      case "--case":
      case "--cases":
        parsed.cases.push(...splitList(next()));
        break;
      case "--repeats":
        parsed.repeats = Number.parseInt(next(), 10);
        break;
      case "--out":
        parsed.out = next();
        break;
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
      default:
        if (!arg.startsWith("-")) {
          parsed.targets.push(arg);
          break;
        }
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!Number.isInteger(parsed.repeats) || parsed.repeats < 1) {
    throw new Error("--repeats must be a positive integer");
  }

  return parsed;
}

function splitList(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function printHelp(): void {
  console.log(`Structured output check

Usage:
  pnpm exec tsx checks/structured-output/run.ts [model] [options]

Options:
  --target <id|model>    Target id or model slug. Repeat or comma-separate. Defaults to all.
                         Use "all" to run the full list explicitly.
  --case <id>            Case id. Repeat or comma-separate. Defaults to all cases.
  --repeats <n>          Repetitions per target/case. Defaults to 1.
  --out <path>           JSONL output path. Defaults to output/checks/*.jsonl.
`);
}
