import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";

const LEDGER_PATH = ".axle/batch.jsonl";

export interface LedgerEntry {
  file: string;
  hash: string;
  timestamp: number;
}

export function computeHash(task: string, fileContent: string | Buffer): string {
  const hash = createHash("sha256");
  hash.update(task);
  hash.update("\0");
  hash.update(fileContent);
  return hash.digest("hex");
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
      if (entry.file && entry.hash) {
        entries.set(entry.file, entry);
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
