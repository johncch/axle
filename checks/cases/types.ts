import type { AIProvider, AxleModelRequestOptions } from "@fifthrevision/axle";
import type { ProviderId } from "../providers.js";

export interface CheckCaseContext {
  provider: AIProvider;
  model: string;
  providerId: ProviderId;
  requestOptions: AxleModelRequestOptions;
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

export interface CheckCase {
  id: string;
  description: string;
  group: CheckCaseGroup;
  providers?: ProviderId[];
  exclusions?: CheckCaseExclusion[];
  run(context: CheckCaseContext): Promise<CheckCaseResult>;
}
