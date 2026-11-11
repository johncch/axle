import type { FileInfo } from "@fifthrevision/axle";
import { loadFileContent } from "@fifthrevision/axle";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const OSASCRIPT_TIMEOUT_MS = 5_000;

const WRITE_CLIPBOARD_PNG = [
  "on run argv",
  "set png to the clipboard as «class PNGf»",
  "set handle to open for access POSIX file (item 1 of argv) with write permission",
  "write png to handle",
  "close access handle",
  "end run",
];
const CLIPBOARD_FILE_PATH = "POSIX path of (the clipboard as «class furl»)";

export type ClipboardImage =
  { status: "image"; file: FileInfo } | { status: "none" } | { status: "unsupported" };

/** Load an image file for attaching; undefined when it is missing or not an image. */
export async function loadImageFile(path: string): Promise<FileInfo | undefined> {
  try {
    const file = await loadFileContent(path);
    return file.kind === "image" ? file : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Read an image from the system clipboard of the machine the CLI runs on:
 * image data, or a copied image file. macOS only.
 */
export async function readClipboardImage(): Promise<ClipboardImage> {
  if (process.platform !== "darwin") return { status: "unsupported" };
  const file = (await readClipboardImageData()) ?? (await readClipboardImageFile());
  return file ? { status: "image", file } : { status: "none" };
}

async function readClipboardImageData(): Promise<FileInfo | undefined> {
  const directory = await mkdtemp(join(tmpdir(), "axle-clipboard-"));
  const target = join(directory, "clipboard.png");
  try {
    await osascript(WRITE_CLIPBOARD_PNG, target);
    const bytes = await readFile(target);
    if (bytes.length === 0) return undefined;
    return {
      kind: "image",
      mimeType: "image/png",
      name: "clipboard.png",
      size: bytes.length,
      source: { type: "base64", data: bytes.toString("base64") },
    };
  } catch {
    return undefined;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function readClipboardImageFile(): Promise<FileInfo | undefined> {
  try {
    const path = (await osascript([CLIPBOARD_FILE_PATH])).trim();
    return path ? await loadImageFile(path) : undefined;
  } catch {
    return undefined;
  }
}

async function osascript(lines: string[], ...args: string[]): Promise<string> {
  const { stdout } = await run("osascript", [...lines.flatMap((line) => ["-e", line]), ...args], {
    timeout: OSASCRIPT_TIMEOUT_MS,
  });
  return stdout;
}
