import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";

const LEDGER_PATH = ".axle/batch.jsonl";

/**
 * One line per batch item run: a thin input→session index, scoped by job
 * name or recipe path. The session file holds the actual state; a failed
 * item is inspected
 * or continued with ordinary `axle resume <id>`. Later lines for the same
 * (job, input) win. The hash covers input content only — input changes are
 * the ledger's problem; recipe changes are the user's (see
 * docs/architecture/cli.md).
 */
export interface LedgerEntry {
  job: string;
  file: string;
  hash: string;
  sessionId: string;
  status: "completed" | "failed";
  timestamp: number;
}

export function computeHash(fileContent: string | Buffer): string {
  return createHash("sha256").update(fileContent).digest("hex");
}

export function ledgerKey(job: string, file: string): string {
  return `${job}\u0000${file}`;
}

export async function loadLedger(path = LEDGER_PATH): Promise<Map<string, LedgerEntry>> {
  const entries = new Map<string, LedgerEntry>();

  let raw: string;
  try {
    raw = await readFile(path, "utf-8");
  } catch {
    return entries;
  }

  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const entry: LedgerEntry = JSON.parse(trimmed);
      if (entry.job && entry.file && entry.hash && entry.sessionId && entry.status) {
        entries.set(ledgerKey(entry.job, entry.file), entry);
      }
    } catch {
      // skip malformed lines
    }
  }

  return entries;
}

export async function appendLedgerEntry(entry: LedgerEntry, path = LEDGER_PATH): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, JSON.stringify(entry) + "\n", "utf-8");
}
