import { rm } from "node:fs/promises";
import { join } from "node:path";

export default async function globalSetup() {
  // Return the teardown function
  return async function teardown() {
    const testTempDir = join(process.cwd(), "test-temp");
    try {
      await rm(testTempDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore errors if directory doesn't exist
    }
  };
}
