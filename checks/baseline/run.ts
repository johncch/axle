import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { inspect } from "node:util";
import { baselineCases } from "./cases.js";
import { resolveProviderTargets } from "./providers.js";

interface RunOptions {
  provider?: string;
  model?: string;
  cases: string[];
  out: string;
}

interface CheckRecord {
  timestamp: string;
  providerId: string;
  model: string;
  caseId: string;
  caseDescription: string;
  status: "pass" | "fail" | "error";
  durationMs: number;
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
    total += 1;
    const startedAt = Date.now();

    try {
      const result = await testCase.run({
        provider,
        model: target.model,
        providerId: target.id,
      });
      const status = result.ok ? "pass" : "fail";
      if (result.ok) passed += 1;

      const record: CheckRecord = {
        timestamp: new Date().toISOString(),
        providerId: target.id,
        model: target.model,
        caseId: testCase.id,
        caseDescription: testCase.description,
        status,
        durationMs: Date.now() - startedAt,
        details: result.details,
      };
      await writeRecord(record);
      if (status !== "pass") failedRecords.push(record);
      console.log(`  ${formatStatus(status)} [${testCase.id}]`);
    } catch (error) {
      const record: CheckRecord = {
        timestamp: new Date().toISOString(),
        providerId: target.id,
        model: target.model,
        caseId: testCase.id,
        caseDescription: testCase.description,
        status: "error",
        durationMs: Date.now() - startedAt,
        error: serializeError(error),
      };
      await writeRecord(record);
      failedRecords.push(record);
      console.log(`  ${formatStatus("error")} [${testCase.id}]`);
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
    console.log(formatDetails(record.details ?? record.error));
  }
}
console.log(`[Output] ${options.out}`);

if (failedRecords.length > 0) process.exitCode = 1;

async function writeRecord(record: CheckRecord): Promise<void> {
  await writeFile(options.out, `${JSON.stringify(record)}\n`, { flag: "a" });
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

function parseArgs(args: string[]): RunOptions {
  const parsed: RunOptions = {
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

function printHelp(): void {
  console.log(`Baseline provider checks

Usage:
  pnpm exec tsx checks/baseline/run.ts [provider] [options]

Options:
  --provider <id>    Provider id: openai, anthropic, gemini, openrouter.
  --model <model>    Override model for the selected provider. Requires --provider.
  --case <id>        Case id. Repeat or comma-separate. Defaults to all cases.
  --out <path>       JSONL output path. Defaults to output/checks/*.jsonl.
`);
}
