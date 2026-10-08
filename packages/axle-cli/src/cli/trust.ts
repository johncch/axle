import { mkdir, readFile, realpath } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import { writeFileAtomic } from "./atomic-write.js";
import { resolveConfigDirs } from "./configs/paths.js";
import { partitionByTrust } from "./tools.js";

export const TRUST_FILE_VERSION = 1;

const TrustFileSchema = z.strictObject({
  version: z.literal(TRUST_FILE_VERSION),
  folders: z.record(z.string(), z.strictObject({ trustedAt: z.string() })),
});

export type TrustFile = z.infer<typeof TrustFileSchema>;

export function trustFilePath(home?: string): string {
  return join(resolveConfigDirs({ home }).user, "trust.json");
}

/**
 * Whether `folder` has been trusted with `axle trust`. The match is exact
 * on the canonical path: trusting a parent does not trust the folders
 * under it.
 */
export async function isFolderTrusted(folder: string, home?: string): Promise<boolean> {
  const file = await readTrustFile(home);
  return (await realpath(folder)) in file.folders;
}

/**
 * Whether trusting the folder would change the run: the prompt is only
 * worth asking when an untrusted answer skips or drops something.
 */
export function trustWouldChange(projectInputs: string[], requestedTools: string[]): boolean {
  return projectInputs.length > 0 || partitionByTrust(requestedTools).dropped.length > 0;
}

export interface TrustOutcome {
  path: string;
  changed: boolean;
}

export async function trustFolder(folder: string, home?: string): Promise<TrustOutcome> {
  const path = await realpath(folder);
  const file = await readTrustFile(home);
  if (path in file.folders) return { path, changed: false };
  file.folders[path] = { trustedAt: new Date().toISOString() };
  await writeTrustFile(file, home);
  return { path, changed: true };
}

export async function untrustFolder(folder: string, home?: string): Promise<TrustOutcome> {
  const path = await realpath(folder);
  const file = await readTrustFile(home);
  if (!(path in file.folders)) return { path, changed: false };
  delete file.folders[path];
  await writeTrustFile(file, home);
  return { path, changed: true };
}

async function readTrustFile(home?: string): Promise<TrustFile> {
  const path = trustFilePath(home);
  let content: string;
  try {
    content = await readFile(path, "utf-8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      return { version: TRUST_FILE_VERSION, folders: {} };
    }
    throw e;
  }
  const parsed = TrustFileSchema.safeParse(JSON.parse(content));
  if (!parsed.success) {
    throw new Error(`Invalid trust file at ${path}; delete it and run axle trust again.`);
  }
  return parsed.data;
}

async function writeTrustFile(file: TrustFile, home?: string): Promise<void> {
  const path = trustFilePath(home);
  await mkdir(dirname(path), { recursive: true });
  await writeFileAtomic(path, JSON.stringify(file, null, 2) + "\n");
}
