import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appendLedgerEntry, computeHash, ledgerKey, loadLedger } from "../../src/cli/ledger.js";

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
    it("should return a consistent hash for the same content", () => {
      expect(computeHash("content")).toBe(computeHash("content"));
    });

    it("should change when the file content changes", () => {
      expect(computeHash("content-a")).not.toBe(computeHash("content-b"));
    });

    it("should work with Buffer content", () => {
      expect(computeHash("hello")).toBe(computeHash(Buffer.from("hello")));
    });
  });

  describe("loadLedger", () => {
    it("should return an empty map when file does not exist", async () => {
      const ledger = await loadLedger(join(TEST_DIR, "missing.jsonl"));
      expect(ledger.size).toBe(0);
    });

    it("should parse valid entries", async () => {
      const entries = [
        {
          job: "j",
          file: "a.md",
          hash: "aaa",
          sessionId: "s-a",
          status: "completed",
          timestamp: 1,
        },
        {
          job: "j",
          file: "b.md",
          hash: "bbb",
          sessionId: "s-b",
          status: "completed",
          timestamp: 2,
        },
      ];
      await writeFile(TEST_LEDGER, entries.map((e) => JSON.stringify(e)).join("\n") + "\n");

      const ledger = await loadLedger(TEST_LEDGER);
      expect(ledger.size).toBe(2);
      expect(ledger.get(ledgerKey("j", "a.md"))?.hash).toBe("aaa");
      expect(ledger.get(ledgerKey("j", "b.md"))?.hash).toBe("bbb");
    });

    it("should skip malformed lines", async () => {
      const lines = [
        JSON.stringify({
          job: "j",
          file: "a.md",
          hash: "aaa",
          sessionId: "s-a",
          status: "completed",
          timestamp: 1,
        }),
        "not json at all",
        JSON.stringify({
          job: "j",
          file: "b.md",
          hash: "bbb",
          sessionId: "s-b",
          status: "completed",
          timestamp: 2,
        }),
      ];
      await writeFile(TEST_LEDGER, lines.join("\n") + "\n");

      const ledger = await loadLedger(TEST_LEDGER);
      expect(ledger.size).toBe(2);
    });

    it("should let later entries overwrite earlier ones", async () => {
      const entries = [
        { job: "j", file: "a.md", hash: "old", sessionId: "s-1", status: "failed", timestamp: 1 },
        {
          job: "j",
          file: "a.md",
          hash: "new",
          sessionId: "s-2",
          status: "completed",
          timestamp: 2,
        },
      ];
      await writeFile(TEST_LEDGER, entries.map((e) => JSON.stringify(e)).join("\n") + "\n");

      const ledger = await loadLedger(TEST_LEDGER);
      expect(ledger.size).toBe(1);
      expect(ledger.get(ledgerKey("j", "a.md"))?.hash).toBe("new");
    });
  });

  describe("appendLedgerEntry", () => {
    it("should create directory and append entry", async () => {
      const nested = join(TEST_DIR, "sub", "batch.jsonl");
      const entry = {
        job: "j",
        file: "a.md",
        hash: "aaa",
        sessionId: "s-a",
        status: "completed" as const,
        timestamp: Date.now(),
      };

      await appendLedgerEntry(entry, nested);

      const raw = await readFile(nested, "utf-8");
      const parsed = JSON.parse(raw.trim());
      expect(parsed.file).toBe("a.md");
      expect(parsed.hash).toBe("aaa");
    });

    it("should append multiple entries", async () => {
      const entry1 = {
        job: "j",
        file: "a.md",
        hash: "aaa",
        sessionId: "s-a",
        status: "completed" as const,
        timestamp: 1,
      };
      const entry2 = {
        job: "j",
        file: "b.md",
        hash: "bbb",
        sessionId: "s-b",
        status: "failed" as const,
        timestamp: 2,
      };

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
