import type { ReasoningSetting } from "@fifthrevision/axle";
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const LEDGER_PATH = join("checks", "ledger.jsonl");

type CaseStatus = "pass" | "fail" | "error" | "skip";

interface RecordedCase {
  caseId: string;
  status: CaseStatus;
  skipReason?: string;
  failureReasons?: string[];
}

export interface AxleRevision {
  version: string;
  commit: string;
  dirty: boolean;
}

export interface LedgerEntry {
  model: string;
  provider: string;
  recordedAt: string;
  axle: AxleRevision;
  group: string;
  reasoning?: ReasoningSetting;
  counts: Record<CaseStatus, number>;
  passed: string[];
  failed: Array<{ case: string; status: "fail" | "error"; reasons: string[] }>;
  skipped: Array<{ case: string; reason: string }>;
}

export async function readAxleRevision(): Promise<AxleRevision> {
  const manifest = JSON.parse(await readFile(join("packages", "axle", "package.json"), "utf8")) as {
    version: string;
  };
  return {
    version: manifest.version,
    commit: git("rev-parse", "--short", "HEAD"),
    dirty: git("status", "--porcelain") !== "",
  };
}

function git(...args: string[]): string {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

export function buildLedgerEntry(run: {
  model: string;
  provider: string;
  axle: AxleRevision;
  group: string;
  reasoning?: ReasoningSetting;
  records: RecordedCase[];
}): LedgerEntry {
  const counts: Record<CaseStatus, number> = { pass: 0, fail: 0, error: 0, skip: 0 };
  const passed: string[] = [];
  const failed: LedgerEntry["failed"] = [];
  const skipped: LedgerEntry["skipped"] = [];

  for (const record of run.records) {
    counts[record.status] += 1;
    switch (record.status) {
      case "pass":
        passed.push(record.caseId);
        break;
      case "skip":
        skipped.push({ case: record.caseId, reason: record.skipReason ?? "" });
        break;
      case "fail":
      case "error":
        failed.push({
          case: record.caseId,
          status: record.status,
          reasons: record.failureReasons ?? [],
        });
        break;
    }
  }

  return {
    model: run.model,
    provider: run.provider,
    recordedAt: new Date().toISOString(),
    axle: run.axle,
    group: run.group,
    ...(run.reasoning !== undefined ? { reasoning: run.reasoning } : {}),
    counts,
    passed,
    failed,
    skipped,
  };
}

export async function upsertLedgerEntries(entries: LedgerEntry[]): Promise<void> {
  const byModel = new Map<string, LedgerEntry>();
  for (const entry of [...(await readLedger()), ...entries]) byModel.set(entry.model, entry);

  const lines = [...byModel.values()]
    .sort((a, b) => a.model.localeCompare(b.model))
    .map((entry) => JSON.stringify(entry));
  await writeFile(LEDGER_PATH, `${lines.join("\n")}\n`);
}

async function readLedger(): Promise<LedgerEntry[]> {
  let contents: string;
  try {
    contents = await readFile(LEDGER_PATH, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  return contents
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as LedgerEntry);
}
