import type { Stats } from "../types.js";
import type { FileInfo } from "../utils/file.js";

export interface TurnStepMeta {
  assistantMessageId: string;
  toolResultsMessageId?: string;
}

export interface Turn {
  id: string;
  owner: "user" | "agent";
  parts: TurnPart[];
  steps?: TurnStepMeta[];
  usage?: Stats;
}

export type TurnPart = TextPart | FilePart | ThinkingPart | ActionPart;

export interface TextPart {
  id: string;
  type: "text";
  text: string;
}

export interface FilePart {
  id: string;
  type: "file";
  file: FileInfo;
}

export interface ThinkingPart {
  id: string;
  type: "thinking";
  text: string;
  summary?: string;
  redacted?: boolean;
}

interface ActionPartBase {
  id: string;
  type: "action";
  kind: string;
  status: "pending" | "running" | "complete" | "error";
}

export interface ToolAction extends ActionPartBase {
  kind: "tool";
  detail: {
    providerId: string;
    name: string;
    parameters: Record<string, unknown>;
    result?: ActionResult;
  };
}

export interface SubagentAction extends ActionPartBase {
  kind: "agent";
  detail: {
    name: string;
    config?: Record<string, unknown>;
    children: Turn[];
    result?: ActionResult;
  };
}

export interface InternalToolAction extends ActionPartBase {
  kind: "internal-tool";
  detail: {
    providerId: string;
    name: string;
    input?: unknown;
    result?: ActionResult;
  };
}

export type ActionPart = ToolAction | SubagentAction | InternalToolAction;

export type ActionResult =
  | { type: "success"; content: unknown }
  | { type: "error"; error: { type: string; message: string } };
