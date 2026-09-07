import type { AIProvider, AxleModelRequestOptions } from "@fifthrevision/axle";
import type { BaselineProviderId } from "../providers.js";

export interface BaselineCaseContext {
  provider: AIProvider;
  model: string;
  providerId: BaselineProviderId;
  requestOptions: AxleModelRequestOptions;
}

export interface BaselineCaseResult {
  ok: boolean;
  failureReasons?: string[];
  details?: Record<string, unknown>;
}

export interface BaselineCaseExclusion {
  provider: BaselineProviderId;
  model?: RegExp;
  reason: string;
}

export type BaselineCaseGroup = "default" | "extended";

export interface BaselineCase {
  id: string;
  description: string;
  group: BaselineCaseGroup;
  providers?: BaselineProviderId[];
  exclusions?: BaselineCaseExclusion[];
  run(context: BaselineCaseContext): Promise<BaselineCaseResult>;
}
