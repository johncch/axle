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

export interface LedgerCase {
  status: CaseStatus;
  reasons?: string[];
  reasoning?: ReasoningSetting;
  recordedAt: string;
  commit: string;
}

export interface LedgerEntry {
  model: string;
  provider: string;
  recordedAt: string;
  axle: AxleRevision;
  counts: Record<CaseStatus, number>;
  cases: Record<string, LedgerCase>;
}

export interface LedgerRun {
  model: string;
  provider: string;
  axle: AxleRevision;
  reasoning?: ReasoningSetting;
  records: RecordedCase[];
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

/**
 * Folds a run into the model's ledger entry: cases the run executed replace
 * their previous result, cases it did not execute keep theirs, and cases that
 * are no longer in the suite are dropped.
 */
export function mergeLedgerRun(
  existing: LedgerEntry | undefined,
  run: LedgerRun,
  suiteCaseIds: string[],
): LedgerEntry {
  const recordedAt = new Date().toISOString();
  const commit = run.axle.dirty ? `${run.axle.commit}-dirty` : run.axle.commit;
  const ran = new Map(run.records.map((record) => [record.caseId, record]));
  const kept = existing?.provider === run.provider ? existing.cases : {};

  const counts: Record<CaseStatus, number> = { pass: 0, fail: 0, error: 0, skip: 0 };
  const cases: Record<string, LedgerCase> = {};
  for (const caseId of suiteCaseIds) {
    const record = ran.get(caseId);
    const ledgerCase = record
      ? toLedgerCase(record, { recordedAt, commit, reasoning: run.reasoning })
      : kept[caseId];
    if (!ledgerCase) continue;
    cases[caseId] = ledgerCase;
    counts[ledgerCase.status] += 1;
  }

  return {
    model: run.model,
    provider: run.provider,
    recordedAt,
    axle: run.axle,
    counts,
    cases,
  };
}

function toLedgerCase(
  record: RecordedCase,
  stamp: { recordedAt: string; commit: string; reasoning?: ReasoningSetting },
): LedgerCase {
  const reasons =
    record.status === "skip" ? [record.skipReason ?? ""] : (record.failureReasons ?? []);
  return {
    status: record.status,
    ...(reasons.length > 0 ? { reasons } : {}),
    ...(stamp.reasoning !== undefined ? { reasoning: stamp.reasoning } : {}),
    recordedAt: stamp.recordedAt,
    commit: stamp.commit,
  };
}

export async function recordLedgerRuns(runs: LedgerRun[], suiteCaseIds: string[]): Promise<void> {
  const byModel = new Map((await readLedger()).map((entry) => [entry.model, entry]));
  for (const run of runs) {
    byModel.set(run.model, mergeLedgerRun(byModel.get(run.model), run, suiteCaseIds));
  }

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
