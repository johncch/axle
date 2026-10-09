import type { AIProvider, AxleModelRequestOptions, DecisionProvider } from "@fifthrevision/axle";
import type { ProviderId } from "../providers.js";

export interface CheckCaseContext {
  provider: AIProvider;
  model: string;
  providerId: ProviderId;
  requestOptions: AxleModelRequestOptions;
}

export interface DecisionCheckCaseContext {
  provider: DecisionProvider;
  model: string;
  providerId: ProviderId;
}

export interface CheckCaseResult {
  ok: boolean;
  failureReasons?: string[];
  details?: Record<string, unknown>;
}

export interface CheckCaseExclusion {
  provider: ProviderId;
  model?: RegExp;
  reason: string;
}

export type CheckCaseGroup = "default" | "extended";

interface CheckCaseBase {
  id: string;
  description: string;
  group: CheckCaseGroup;
  providers?: ProviderId[];
  exclusions?: CheckCaseExclusion[];
}

export interface CheckCase extends CheckCaseBase {
  kind?: "chat";
  run(context: CheckCaseContext): Promise<CheckCaseResult>;
}

export interface DecisionCheckCase extends CheckCaseBase {
  kind: "decision";
  run(context: DecisionCheckCaseContext): Promise<CheckCaseResult>;
}

export type AnyCheckCase = CheckCase | DecisionCheckCase;
