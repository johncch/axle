import { FileInfo } from "../utils/file.js";
import {
  ContentPart,
  ContentPartFile,
  ContentPartText,
  ContentPartThinking,
  ContentPartToolCall,
} from "./message.js";

export function toContentParts(params: {
  text?: string;
  files?: Array<FileInfo>;
}): Array<ContentPart> {
  const { text, files } = params;
  const parts: Array<ContentPart> = [];

  if (text) {
    parts.push({ type: "text", text });
  }

  if (files) {
    for (const file of files) {
      parts.push({ type: "file", file });
    }
  }

  return parts;
}

export function getTextContent(content: ContentPart[]): string | null {
  if (typeof content === "string") {
    return content;
  }

  return content
    .filter((item) => item.type === "text")
    .map((item) => (item as ContentPartText).text)
    .join("\n\n");
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

export function getToolCalls(
  content: Array<ContentPartText | ContentPartThinking | ContentPartToolCall>,
): ContentPartToolCall[] {
  return content.filter((item) => item.type === "tool-call") as ContentPartToolCall[];
}
