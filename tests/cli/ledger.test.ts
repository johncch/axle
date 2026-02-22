import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appendLedgerEntry, computeHash, loadLedger } from "../../src/cli/ledger.js";

const TEST_DIR = join(import.meta.dirname, "__ledger_test_tmp__");
const TEST_LEDGER = join(TEST_DIR, "batch.jsonl");

describe("Ledger", () => {
  beforeEach(async () => {
    await mkdir(TEST_DIR, { recursive: true });
  });

  afterEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  describe("computeHash", () => {
    it("should return a consistent hash for the same inputs", () => {
      const a = computeHash("task", "content");
      const b = computeHash("task", "content");
      expect(a).toBe(b);
    });

    it("should change when the task changes", () => {
      const a = computeHash("task-a", "content");
      const b = computeHash("task-b", "content");
      expect(a).not.toBe(b);
    });

    it("should change when the file content changes", () => {
      const a = computeHash("task", "content-a");
      const b = computeHash("task", "content-b");
      expect(a).not.toBe(b);
    });

    it("should work with Buffer content", () => {
      const str = computeHash("task", "hello");
      const buf = computeHash("task", Buffer.from("hello"));
      expect(str).toBe(buf);
    });
  });

  describe("loadLedger", () => {
    it("should return an empty map when file does not exist", async () => {
      const ledger = await loadLedger(join(TEST_DIR, "missing.jsonl"));
      expect(ledger.size).toBe(0);
    });

    it("should parse valid entries", async () => {
      const entries = [
        { file: "a.md", hash: "aaa", timestamp: 1 },
        { file: "b.md", hash: "bbb", timestamp: 2 },
      ];
      await writeFile(TEST_LEDGER, entries.map((e) => JSON.stringify(e)).join("\n") + "\n");

      const ledger = await loadLedger(TEST_LEDGER);
      expect(ledger.size).toBe(2);
      expect(ledger.get("a.md")?.hash).toBe("aaa");
      expect(ledger.get("b.md")?.hash).toBe("bbb");
    });

    it("should skip malformed lines", async () => {
      const lines = [
        JSON.stringify({ file: "a.md", hash: "aaa", timestamp: 1 }),
        "not json at all",
        JSON.stringify({ file: "b.md", hash: "bbb", timestamp: 2 }),
      ];
      await writeFile(TEST_LEDGER, lines.join("\n") + "\n");

      const ledger = await loadLedger(TEST_LEDGER);
      expect(ledger.size).toBe(2);
    });

    it("should let later entries overwrite earlier ones", async () => {
      const entries = [
        { file: "a.md", hash: "old", timestamp: 1 },
        { file: "a.md", hash: "new", timestamp: 2 },
      ];
      await writeFile(TEST_LEDGER, entries.map((e) => JSON.stringify(e)).join("\n") + "\n");

      const ledger = await loadLedger(TEST_LEDGER);
      expect(ledger.size).toBe(1);
      expect(ledger.get("a.md")?.hash).toBe("new");
    });
  });

  describe("appendLedgerEntry", () => {
    it("should create directory and append entry", async () => {
      const nested = join(TEST_DIR, "sub", "batch.jsonl");
      const entry = { file: "a.md", hash: "aaa", timestamp: Date.now() };

      await appendLedgerEntry(entry, nested);

      const raw = await readFile(nested, "utf-8");
      const parsed = JSON.parse(raw.trim());
      expect(parsed.file).toBe("a.md");
      expect(parsed.hash).toBe("aaa");
    });

    it("should append multiple entries", async () => {
      const entry1 = { file: "a.md", hash: "aaa", timestamp: 1 };
      const entry2 = { file: "b.md", hash: "bbb", timestamp: 2 };

      await appendLedgerEntry(entry1, TEST_LEDGER);
      await appendLedgerEntry(entry2, TEST_LEDGER);

      const raw = await readFile(TEST_LEDGER, "utf-8");
      const lines = raw.trim().split("\n");
      expect(lines).toHaveLength(2);
      expect(JSON.parse(lines[0]).file).toBe("a.md");
      expect(JSON.parse(lines[1]).file).toBe("b.md");
    });
  });
});
