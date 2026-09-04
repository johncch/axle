import { chmod, rename, rm, writeFile } from "node:fs/promises";

/**
 * Write-then-rename so a crash mid-save never truncates the target. The
 * chmod covers a leftover `.tmp` from an earlier crash: writeFile's mode
 * only applies on creation, so truncating an existing tmp keeps its old
 * mode.
 */
export async function writeFileAtomic(
  path: string,
  content: string,
  options?: { mode?: number },
): Promise<void> {
  const tmpPath = `${path}.tmp`;
  try {
    await writeFile(tmpPath, content, options?.mode !== undefined ? { mode: options.mode } : {});
    if (options?.mode !== undefined) await chmod(tmpPath, options.mode);
    await rename(tmpPath, path);
  } catch (e) {
    await rm(tmpPath, { force: true }).catch(() => {});
    throw e;
  }
}
