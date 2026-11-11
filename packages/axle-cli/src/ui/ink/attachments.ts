import type { FileInfo } from "@fifthrevision/axle";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ChatInput } from "../renderer.js";

export type Attachment = { kind: "paste"; text: string } | { kind: "image"; file: FileInfo };

/** Placeholder character to the attachment it stands for in the input buffer. */
export type AttachmentTable = ReadonlyMap<string, Attachment>;

const FIRST_PLACEHOLDER = 0xe100;
const LAST_PLACEHOLDER = 0xe1ff;
const RESERVED = /[-]/g;

const COLLAPSE_LINES = 5;
const COLLAPSE_CHARACTERS = 500;

const IMAGE_PATH = /\.(png|jpe?g|gif|webp)$/i;

const IMAGE_SIGNATURES = [
  {
    mimeType: "image/png",
    extension: "png",
    base64: "iVBORw0KGgo",
    bytes: [0x89, 0x50, 0x4e, 0x47],
  },
  { mimeType: "image/jpeg", extension: "jpg", base64: "/9j/", bytes: [0xff, 0xd8, 0xff] },
  { mimeType: "image/gif", extension: "gif", base64: "R0lGOD", bytes: [0x47, 0x49, 0x46, 0x38] },
  { mimeType: "image/webp", extension: "webp", base64: "UklGR", bytes: [0x52, 0x49, 0x46, 0x46] },
];
const MIN_BASE64_IMAGE_LENGTH = 64;

export function stripReserved(text: string): string {
  return text.replace(RESERVED, "");
}

export function nextPlaceholder(table: AttachmentTable): string | undefined {
  const code = FIRST_PLACEHOLDER + table.size;
  return code > LAST_PLACEHOLDER ? undefined : String.fromCharCode(code);
}

export function shouldCollapse(text: string): boolean {
  return text.length > COLLAPSE_CHARACTERS || text.split("\n").length > COLLAPSE_LINES;
}

export function placeholderLabels(text: string, table: AttachmentTable): Map<string, string> {
  const labels = new Map<string, string>();
  let images = 0;
  for (const character of text) {
    const attachment = table.get(character);
    if (!attachment || labels.has(character)) continue;
    if (attachment.kind === "image") {
      images++;
      labels.set(character, `[Image ${images}]`);
      continue;
    }
    const lines = attachment.text.split("\n").length;
    labels.set(
      character,
      lines > 1 ? `[Pasted ${lines} lines]` : `[Pasted ${attachment.text.length} characters]`,
    );
  }
  return labels;
}

export function renderPlaceholders(text: string, labels: ReadonlyMap<string, string>): string {
  if (labels.size === 0) return text;
  return text.replace(RESERVED, (character) => labels.get(character) ?? "");
}

/** Turn the input buffer into what is sent: pastes in full, images as attachments. */
export function resolveInput(text: string, table: AttachmentTable): ChatInput {
  const labels = placeholderLabels(text, table);
  if (labels.size === 0) return { text, images: [] };

  const images: FileInfo[] = [];
  const sent = text.replace(RESERVED, (character) => {
    const attachment = table.get(character);
    if (!attachment) return "";
    if (attachment.kind === "paste") return attachment.text;
    images.push(attachment.file);
    return labels.get(character) ?? "";
  });
  return { text: sent, display: renderPlaceholders(text, labels), images };
}

/** The file path a paste stands for, when the whole paste is one path to an image file. */
export function pastedImagePath(pasted: string): string | undefined {
  let text = pasted.trim();
  if (text === "" || text.includes("\n")) return undefined;

  const quoted = text.match(/^(['"])(.*)\1$/);
  if (quoted) {
    text = quoted[2];
  } else if (text.startsWith("file://")) {
    try {
      text = fileURLToPath(text);
    } catch {
      return undefined;
    }
  } else {
    text = text.replace(/\\(.)/g, "$1");
  }

  if (text.startsWith("~/")) text = join(homedir(), text.slice(2));
  if (!isAbsolute(text) || !IMAGE_PATH.test(text)) return undefined;
  return text;
}

/** The image a paste encodes, when the whole paste is base64 image data. */
export function decodeBase64Image(pasted: string, name = "pasted-image"): FileInfo | undefined {
  const compact = pasted.trim().replace(/[\r\n]+/g, "");
  if (compact.length < MIN_BASE64_IMAGE_LENGTH || compact.length % 4 !== 0) return undefined;
  const signature = IMAGE_SIGNATURES.find((candidate) => compact.startsWith(candidate.base64));
  if (!signature || !/^[A-Za-z0-9+/]+={0,2}$/.test(compact)) return undefined;

  const bytes = Buffer.from(compact, "base64");
  if (!signature.bytes.every((byte, index) => bytes[index] === byte)) return undefined;
  return {
    kind: "image",
    mimeType: signature.mimeType,
    name: `${name}.${signature.extension}`,
    size: bytes.length,
    source: { type: "base64", data: compact },
  };
}
