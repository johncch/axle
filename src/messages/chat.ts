import { AxleStopReason } from "../ai/types.js";
import { ToolSchema } from "../tools/types.js";
import { FileInfo } from "../utils/file.js";
import {
  AxleMessage,
  AxleToolCallResult,
  ContentPart,
  ContentPartFile,
  ContentPartInstructions,
  ContentPartText,
  ContentPartThinking,
  ContentPartToolCall,
} from "./types.js";

interface ChatAssistantParams {
  id: string;
  model: string;
  content: Array<ContentPartText | ContentPartThinking>;
  finishReason: AxleStopReason;
  toolCalls?: ContentPartToolCall[];
}

export class Chat {
  system: string;
  messages: AxleMessage[] = [];
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

    const content: ContentPart[] = [{ type: "text", text: message } as ContentPartText];
    if (instructions) {
      content.push({
        type: "instructions",
        instructions,
      } as ContentPartInstructions);
    }

    for (const file of files) {
      content.push({ type: "file", file } as ContentPartFile);
    }

    this.messages.push({ role: "user", content });
  }

  addAssistant(message: string);
  addAssistant(params: ChatAssistantParams);
  addAssistant(obj: string | ChatAssistantParams): void {
    if (typeof obj === "string") {
      const text = obj as string;
      this.messages.push({
        role: "assistant",
        id: crypto.randomUUID(),
        content: [{ type: "text", text }],
        model: "user",
        finishReason: AxleStopReason.Custom,
      });
    } else {
      this.messages.push({
        role: "assistant",
        ...obj,
      });
    }
  }

  addTools(input: Array<AxleToolCallResult>) {
    this.messages.push({
      role: "tool",
      content: input,
    });
  }

  hasFiles(): boolean {
    return this.messages.some(
      (msg) => Array.isArray(msg.content) && msg.content.some((item) => item.type === "file"),
    );
  }

  latest(): AxleMessage | undefined {
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
  content: string | ContentPart[],
  delimiter: string = "\n\n",
): string | null {
  if (typeof content === "string") {
    return content;
  }

  const textParts = content
    .filter((item) => item.type === "text")
    .map((item) => (item as ContentPartText).text);

  const instructionsParts = content
    .filter((item) => item.type === "instructions")
    .map((item) => (item as ContentPartInstructions).instructions);

  if (textParts.length === 0 && instructionsParts.length === 0) {
    return null;
  }

  return [...textParts, ...instructionsParts].join(delimiter);
}

export function getTextContent(content: string | ContentPart[]): string | null {
  if (typeof content === "string") {
    return content;
  }

  return content
    .filter((item) => item.type === "text")
    .map((item) => (item as ContentPartText).text)
    .join("\n\n");
}

export function getInstructions(content: string | ContentPart[]): string | null {
  if (typeof content === "string") {
    return null;
  }

  const instructions = content
    .filter((item) => item.type === "instructions")
    .map((item) => (item as ContentPartInstructions).instructions);
  if (instructions.length > 0) {
    return instructions.join("\n\n");
  }
  return null;
}

export function getDocuments(content: string | ContentPart[]): FileInfo[] {
  if (typeof content === "string") {
    return [];
  }

  return content
    .filter((item) => item.type === "file" && item.file.type === "document")
    .map((item) => (item as ContentPartFile).file);
}

export function getImages(content: string | ContentPart[]): FileInfo[] {
  if (typeof content === "string") {
    return [];
  }

  return content
    .filter((item) => item.type === "file" && item.file.type === "image")
    .map((item) => (item as ContentPartFile).file);
}

export function getFiles(content: string | ContentPart[]): FileInfo[] {
  if (typeof content === "string") {
    return [];
  }

  return content
    .filter((item) => item.type === "file")
    .map((item) => (item as ContentPartFile).file);
}
