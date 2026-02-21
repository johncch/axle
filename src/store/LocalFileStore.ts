import node_fs from "node:fs/promises";
import node_path from "node:path";
import type { FileStore } from "./types.js";

export class LocalFileStore implements FileStore {
  readonly rootPath: string;

  constructor(rootPath: string) {
    this.rootPath = rootPath;
  }

  async read(path: string): Promise<string | null> {
    const fullPath = node_path.join(this.rootPath, path);
    try {
      return await node_fs.readFile(fullPath, "utf-8");
    } catch {
      return null;
    }
  }

  async write(path: string, content: string): Promise<void> {
    const fullPath = node_path.join(this.rootPath, path);
    await node_fs.mkdir(node_path.dirname(fullPath), { recursive: true });
    await node_fs.writeFile(fullPath, content, "utf-8");
  }
}
