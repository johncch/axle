import type { Stats } from "../types.js";
import type { FileInfo } from "../utils/file.js";

export type TurnStatus = "streaming" | "complete" | "cancelled" | "error";

export interface TimingInfo {
  start: string;
  end?: string;
}

export interface Turn {
  id: string;
  owner: "user" | "agent";
  parts: TurnPart[];
  status: TurnStatus;
  timing?: TimingInfo;
  usage?: Stats;
}

export type TurnPart = TextPart | FilePart | ThinkingPart | ActionPart;

export interface TextPart {
  id: string;
  type: "text";
  text: string;
  timing?: TimingInfo;
}

export interface FilePart {
  id: string;
  type: "file";
  file: FileInfo;
  timing?: TimingInfo;
}

export interface ThinkingPart {
  id: string;
  type: "thinking";
  text: string;
  summary?: string;
  redacted?: boolean;
  timing?: TimingInfo;
}

interface ActionPartBase {
  id: string;
  type: "action";
  kind: string;
  status: "pending" | "running" | "complete" | "cancelled" | "error";
  timing?: TimingInfo;
}

export interface ToolAction extends ActionPartBase {
  kind: "tool";
  detail: {
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

export interface ProviderToolAction extends ActionPartBase {
  kind: "provider-tool";
  detail: {
    name: string;
    input?: unknown;
    result?: ActionResult;
  };
}

export type ActionPart = ToolAction | SubagentAction | ProviderToolAction;

export type ActionResult =
  | { type: "success"; content: unknown }
  | { type: "error"; error: { type: string; message: string } };
