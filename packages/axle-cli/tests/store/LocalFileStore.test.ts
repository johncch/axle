import { rm } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalFileStore } from "../../src/store/LocalFileStore.js";

const TEST_DIR = join(import.meta.dirname, "__local_file_store_tmp__");

afterEach(async () => {
  await rm(TEST_DIR, { recursive: true, force: true });
});

describe("LocalFileStore", () => {
  it("returns null for missing files", async () => {
    const store = new LocalFileStore(TEST_DIR);

    await expect(store.read("missing.txt")).resolves.toBeNull();
  });

  it("creates nested directories and reads written content", async () => {
    const store = new LocalFileStore(TEST_DIR);

    await store.write("a/b/c.txt", "hello");

    await expect(store.read("a/b/c.txt")).resolves.toBe("hello");
  });
});
