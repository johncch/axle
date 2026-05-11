import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Instruct, generate } from "../../src/index.js";
import { structuredOutputCases } from "./cases.js";
import { createBenchmarkProvider, resolveBenchmarkTargets } from "./providers.js";

interface RunOptions {
  targets: string[];
  cases: string[];
  repeats: number;
  out: string;
}

interface BenchmarkRecord {
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
const targets = resolveBenchmarkTargets(options.targets);
const cases =
  options.cases.length === 0
    ? structuredOutputCases
    : structuredOutputCases.filter((testCase) => options.cases.includes(testCase.id));

if (cases.length === 0) {
  throw new Error(`No benchmark cases matched: ${options.cases.join(", ")}`);
}

await mkdir(dirname(options.out), { recursive: true });
await writeFile(options.out, "");

const summary = new Map<string, { success: number; total: number }>();

for (const target of targets) {
  console.log(`[Target] ${target.provider}:${target.model}`);
  const provider = createBenchmarkProvider(target);

  for (const testCase of cases) {
    for (let repeat = 1; repeat <= options.repeats; repeat++) {
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
          await writeRecord({
            ...recordBase,
            status: "model-error",
            durationMs,
            usage: result.usage,
            error: result.error,
          });
          markSummary(target.id, false);
          console.log(`  [${testCase.id}] ${repeat}/${options.repeats} model-error`);
          continue;
        }

        if (result.parseError) {
          await writeRecord({
            ...recordBase,
            status: "parse-error",
            durationMs,
            usage: result.usage,
            rawText: getRawText(result.final?.content),
            error: serializeError(result.parseError),
          });
          markSummary(target.id, false);
          console.log(`  [${testCase.id}] ${repeat}/${options.repeats} parse-error`);
          continue;
        }

        await writeRecord({
          ...recordBase,
          status: "success",
          durationMs,
          usage: result.usage,
          rawText: getRawText(result.final?.content),
          parsed: result.response,
        });
        markSummary(target.id, true);
        console.log(`  [${testCase.id}] ${repeat}/${options.repeats} ok`);
      } catch (error) {
        await writeRecord({
          ...recordBase,
          status: "exception",
          durationMs: Date.now() - startedAt,
          error: serializeError(error),
        });
        markSummary(target.id, false);
        console.log(`  [${testCase.id}] ${repeat}/${options.repeats} exception`);
      }
    }
  }
}

console.log("\n[Summary]");
for (const [targetId, counts] of summary.entries()) {
  const rate = counts.total === 0 ? 0 : (counts.success / counts.total) * 100;
  console.log(`${targetId}: ${counts.success}/${counts.total} (${rate.toFixed(1)}%)`);
}
console.log(`\n[Output] ${options.out}`);

async function writeRecord(record: BenchmarkRecord): Promise<void> {
  await writeFile(options.out, `${JSON.stringify(record)}\n`, { flag: "a" });
}

function markSummary(targetId: string, success: boolean): void {
  const current = summary.get(targetId) ?? { success: 0, total: 0 };
  current.total += 1;
  if (success) current.success += 1;
  summary.set(targetId, current);
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
    out: join("output", "benchmarks", `structured-output-${Date.now()}.jsonl`),
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
  console.log(`Structured output benchmark

Usage:
  pnpm exec tsx benchmarks/structured-output/run.ts [model] [options]

Options:
  --target <id|model>    Target id or model slug. Repeat or comma-separate. Defaults to all.
                         Use "all" to run the full list explicitly.
  --case <id>            Case id. Repeat or comma-separate. Defaults to all cases.
  --repeats <n>          Repetitions per target/case. Defaults to 1.
  --out <path>           JSONL output path. Defaults to output/benchmarks/*.jsonl.
`);
}
