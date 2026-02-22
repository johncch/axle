import { glob } from "glob";
import mime from "mime";
import { access, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import type { TracingContext } from "../tracer/types.js";
import { FilePathInfo, LoadFileResults } from "./types.js";

/**
 * CLI Config and Job File uses this function to search and load for files. The defaults
 * allows for different permutations of name and formats to load.
 *
 * @param path - Path provided by the loader. Can be null if not provided by the user.
 * @param options - Options for loading the file, including defaults and tag.
 * @param options.defaults - Default name and formats to search for if path is null.
 * @param options.tag - A tag for error messages, indicating the type of file being loaded.
 * @returns A promise that resolves to an object containing the file content and format.
 */
export async function searchAndLoadFile(
  path: string | null,
  options: {
    defaults: {
      name: string;
      formats: string[];
    };
    tag: string;
  },
): Promise<LoadFileResults> {
  const { defaults, tag } = options;
  let fileContents: string | null = null;
  let filePath: string = "";
  if (path) {
    try {
      filePath = resolve(path);
      fileContents = await readFile(filePath, { encoding: "utf-8" });
    } catch (e) {
      throw new Error(`${tag} not found, see --help for details`);
    }
  } else {
    for (const format of defaults.formats) {
      try {
        filePath = resolve(defaults.name + "." + format);
        fileContents = await readFile(filePath, { encoding: "utf-8" });
        break;
      } catch (e) {
        continue;
      }
    }
    if (fileContents === null) {
      throw new Error(`${tag} not found, see --help for details`);
    }
  }

  return {
    content: fileContents,
    format: filePath.split(".").pop() ?? "",
    path: filePath,
  };
}

export async function loadManyFiles(filenames: string[], tracer?: TracingContext) {
  let replacement = "";
  for (const name of filenames) {
    const files = await glob(name);
    tracer?.debug(`many-files parser. For glob "${name}", found ${files.length} files.`);
    const replacements = await Promise.all(
      files.map(async (name) => {
        const c = await readFile(name, "utf-8");
        return name + ":\n" + c;
      }),
    );
    replacement += replacements.join("\n");
  }
  return replacement;
}

export function replaceFilePattern(pattern: string, path: FilePathInfo) {
  pattern = pattern.replace("**/*", "**"); // these are equivalent
  const regex = /(?<asterisks>\*{1,2})(?<extension>\.[^\\/]+)?/;
  const match = pattern.match(regex);

  if (match) {
    let replacement = "";
    if (match.groups?.asterisks.length == 1) {
      replacement += path.stem;
    } else {
      replacement += path.dir + path.stem;
    }

    if (match.groups?.extension) {
      replacement += match.groups.extension;
    } else {
      replacement += path.ext;
    }

    return pattern.replace(match[0], replacement);
  }

  return pattern;
}

export function pathToComponents(fullpath: string): FilePathInfo | null {
  const regex = /(?<name>[^\\/]+)(?<extension>\.[^\\/]+)$/;
  const matches = fullpath.match(regex);
  if (matches && matches.length > 0 && matches.groups) {
    return {
      abs: fullpath,
      dir: fullpath.replace(matches[0], ""),
      ext: matches.groups.extension,
      stem: matches.groups.name,
      name: matches[0],
    };
  }
  return null;
}

export async function fileExists({
  baseName,
  directory = ".",
}: {
  baseName: string;
  directory?: string;
}): Promise<boolean> {
  try {
    const files = await glob(`${directory}/${baseName}.*`);
    return files.length > 0;
  } catch {
    return false;
  }
}

// Function to ensure the directory exists
export async function ensureDirectoryExistence(filePath: string) {
  const dirName = dirname(filePath);
  await mkdir(dirName, { recursive: true });
}

// Function to write the file
export async function writeFileWithDirectories({
  filePath,
  content,
}: {
  filePath: string;
  content: string;
}) {
  await ensureDirectoryExistence(filePath);
  await writeFile(filePath, content);
}

const MAX_FILE_SIZE = 20 * 1024 * 1024;

export interface FileInfo {
  path: string;
  base64?: string;
  content?: string;
  mimeType: string;
  size: number;
  name: string;
  type: "image" | "document" | "text";
}

export type TextFileInfo = FileInfo & {
  content: string;
  base64?: never;
  type: "text";
};

export type Base64FileInfo = FileInfo & {
  base64: string;
  content?: never;
  type: "image" | "document";
};

export function isTextFileInfo(fileInfo: FileInfo): fileInfo is TextFileInfo {
  return fileInfo.type === "text";
}

export function isBase64FileInfo(fileInfo: FileInfo): fileInfo is Base64FileInfo {
  return fileInfo.type === "image" || fileInfo.type === "document";
}

/**
 * Get the file type category based on its mime type
 */
const TEXT_LIKE_MIME_TYPES = new Set([
  "application/json",
  "application/xml",
  "application/yaml",
  "application/x-yaml",
  "application/toml",
]);

function isTextLikeMimeType(mimeType: string): boolean {
  return mimeType.startsWith("text/") || TEXT_LIKE_MIME_TYPES.has(mimeType);
}

function getFileCategory(filePath: string): {
  type: "image" | "document" | "text";
  mimeType: string;
} {
  const mimeType = mime.getType(filePath);
  if (!mimeType) {
    const ext = extname(filePath).toLowerCase();
    throw new Error(`Unsupported file type: ${ext || "(no extension)"}`);
  }

  if (mimeType.startsWith("image/")) {
    return { type: "image", mimeType };
  } else if (mimeType === "application/pdf") {
    return { type: "document", mimeType };
  } else if (isTextLikeMimeType(mimeType)) {
    return { type: "text", mimeType };
  } else {
    const ext = extname(filePath).toLowerCase();
    throw new Error(`Unsupported file type: ${ext} (${mimeType})`);
  }
}

/**
 * Detect the appropriate encoding for a file based on its mime type
 */
export function getEncodingForFile(filePath: string): "utf-8" | "base64" {
  const { type } = getFileCategory(filePath);
  return type === "text" ? "utf-8" : "base64";
}

/**
 * Load a file with the specified encoding or auto-detect based on file extension
 * @param filePath - Path to the file
 * @param encoding - How to load the file: "utf-8" for text, "base64" for binary, or omit for auto-detection
 * @returns FileInfo object with appropriate content based on encoding
 */
export async function loadFileContent(filePath: string): Promise<FileInfo>;
export async function loadFileContent(filePath: string, encoding: "utf-8"): Promise<TextFileInfo>;
export async function loadFileContent(
  filePath: string,
  encoding: "base64",
): Promise<Base64FileInfo>;
export async function loadFileContent(
  filePath: string,
  encoding?: "utf-8" | "base64",
): Promise<FileInfo> {
  const resolvedPath = resolve(filePath);

  try {
    await access(resolvedPath);
  } catch {
    throw new Error(`File not found: ${filePath}`);
  }

  const stats = await stat(resolvedPath);

  if (stats.size > MAX_FILE_SIZE) {
    throw new Error(`File too large: ${stats.size} bytes. Maximum allowed: ${MAX_FILE_SIZE} bytes`);
  }

  const fileName = resolvedPath.split("/").pop() || "";
  const category = getFileCategory(resolvedPath);
  const actualEncoding = encoding || (category.type === "text" ? "utf-8" : "base64");

  if (actualEncoding === "utf-8") {
    if (category.type !== "text") {
      throw new Error(`Cannot read ${category.type} file as text: ${filePath}`);
    }

    const content = await readFile(resolvedPath, "utf-8");

    return {
      path: resolvedPath,
      content,
      mimeType: category.mimeType,
      size: stats.size,
      name: fileName,
      type: "text",
    };
  } else {
    if (category.type === "text") {
      throw new Error(`Cannot read text file as binary: ${filePath}`);
    }

    const fileBuffer = await readFile(resolvedPath);
    const base64 = fileBuffer.toString("base64");

    return {
      path: resolvedPath,
      base64,
      mimeType: category.mimeType,
      size: stats.size,
      name: fileName,
      type: category.type,
    };
  }
}
