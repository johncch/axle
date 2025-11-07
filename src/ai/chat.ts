import { ToolSchema } from "../tools/types.js";
import { FileInfo } from "../utils/file.js";
import {
  ChatContent,
  ChatContentFile,
  ChatContentInstructions,
  ChatContentText,
  ChatItem,
  ChatItemToolCallResult,
  ToolCall,
} from "./types.js";

export class Chat {
  system: string;
  messages: ChatItem[] = [];
  tools: ToolSchema[] = [];

  setToolSchemas(schemas: ToolSchema[]) {
    this.tools = schemas;
  }

  addSystem(message: string) {
    this.system = message;
  }

  addUser(message: string): void;
  addUser(message: string, instruction: string): void;
  addUser(message: string, instruction: string, files: FileInfo[]): void;
  addUser(message: string, files: FileInfo[]);
  addUser(message: string, second?: string | FileInfo[], third?: FileInfo[]) {
    let instructions: string | undefined;
    let files: FileInfo[] = [];
    if (typeof second === "string") {
      instructions = second;
      files = third || [];
    } else if (Array.isArray(second)) {
      files = second;
    }

    if (!instructions && files.length === 0) {
      this.messages.push({ role: "user", content: message });
      return;
    }

    const content: ChatContent[] = [
      { type: "text", text: message } as ChatContentText,
    ];
    if (instructions) {
      content.push({
        type: "instructions",
        instructions,
      } as ChatContentInstructions);
    }

    for (const file of files) {
      content.push({ type: "file", file } as ChatContentFile);
    }

    this.messages.push({ role: "user", content });
  }

  addAssistant(message: string, toolCalls?: ToolCall[]) {
    this.messages.push({
      role: "assistant",
      content: message,
      ...(toolCalls && { toolCalls }),
    });
  }

  addTools(input: Array<ChatItemToolCallResult>) {
    this.messages.push({
      role: "tool",
      content: input,
    });
  }

  hasFiles(): boolean {
    return this.messages.some(
      (msg) =>
        Array.isArray(msg.content) &&
        msg.content.some((item) => item.type === "file"),
    );
  }

  latest(): ChatItem | undefined {
    return this.messages[this.messages.length - 1];
  }

  toString() {
    return JSON.stringify({
      system: this.system,
      messages: this.messages,
      tools: this.tools,
    });
  }
}

/* Helper methods for getting data out of content */

export function getTextAndInstructions(
  content: string | ChatContent[],
  delimiter: string = "\n\n",
): string | null {
  if (typeof content === "string") {
    return content;
  }

  const textParts = content
    .filter((item) => item.type === "text")
    .map((item) => (item as ChatContentText).text);

  const instructionsParts = content
    .filter((item) => item.type === "instructions")
    .map((item) => (item as ChatContentInstructions).instructions);

  if (textParts.length === 0 && instructionsParts.length === 0) {
    return null;
  }

  return [...textParts, ...instructionsParts].join(delimiter);
}

export function getTextContent(content: string | ChatContent[]): string | null {
  if (typeof content === "string") {
    return content;
  }

  return content
    .filter((item) => item.type === "text")
    .map((item) => (item as ChatContentText).text)
    .join("\n\n");
}

export function getInstructions(
  content: string | ChatContent[],
): string | null {
  if (typeof content === "string") {
    return null;
  }

  const instructions = content
    .filter((item) => item.type === "instructions")
    .map((item) => (item as ChatContentInstructions).instructions);
  if (instructions.length > 0) {
    return instructions.join("\n\n");
  }
  return null;
}

export function getDocuments(content: string | ChatContent[]): FileInfo[] {
  if (typeof content === "string") {
    return [];
  }

  return content
    .filter((item) => item.type === "file" && item.file.type === "document")
    .map((item) => (item as ChatContentFile).file);
}

export function getImages(content: string | ChatContent[]): FileInfo[] {
  if (typeof content === "string") {
    return [];
  }

  return content
    .filter((item) => item.type === "file" && item.file.type === "image")
    .map((item) => (item as ChatContentFile).file);
}

export function getFiles(content: string | ChatContent[]): FileInfo[] {
  if (typeof content === "string") {
    return [];
  }

  return content
    .filter((item) => item.type === "file")
    .map((item) => (item as ChatContentFile).file);
}
