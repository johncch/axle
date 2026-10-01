import { FileInfo } from "../utils/file.js";
import {
  Citation,
  ContentPart,
  ContentPartCitation,
  ContentPartFile,
  ContentPartProviderTool,
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

export function getTextContent(content: string | ContentPart[]): string {
  if (typeof content === "string") return content;

  let text = "";
  let separatedFromPreviousText = false;
  for (const part of content) {
    if (part.type === "citation") continue;
    if (part.type !== "text") {
      separatedFromPreviousText = text !== "";
      continue;
    }
    text += separatedFromPreviousText ? `\n\n${part.text}` : part.text;
    separatedFromPreviousText = false;
  }
  return text;
}

export function getThinkingContent(content: ContentPart[]): string {
  return content
    .filter((item) => item.type === "thinking")
    .map((item) => (item as ContentPartThinking).text ?? "")
    .join("\n\n");
}

export function getDocuments(content: string | ContentPart[]): FileInfo[] {
  if (typeof content === "string") {
    return [];
  }

  return content
    .filter((item) => item.type === "file" && item.file.kind === "document")
    .map((item) => (item as ContentPartFile).file);
}

export function getImages(content: string | ContentPart[]): FileInfo[] {
  if (typeof content === "string") {
    return [];
  }

  return content
    .filter((item) => item.type === "file" && item.file.kind === "image")
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
  content: Array<ContentPartText | ContentPartThinking | ContentPartToolCall | ContentPartCitation>,
): ContentPartToolCall[] {
  return content.filter((item) => item.type === "tool-call") as ContentPartToolCall[];
}

export function getProviderTools(content: ContentPart[]): ContentPartProviderTool[] {
  return content.filter((item) => item.type === "provider-tool") as ContentPartProviderTool[];
}

export function getCitations(content: ContentPart[]): Citation[] {
  const citations: Citation[] = [];
  for (const item of content) {
    if (item.type === "text" && item.citations) {
      citations.push(...item.citations);
    } else if (item.type === "citation") {
      citations.push(...item.citations);
    }
  }
  return citations;
}
