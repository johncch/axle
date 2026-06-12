import type { WebSearchBackend } from "./tools/webSearch.js";

export interface AxleConfiguration {
  webSearchFallback?: WebSearchBackend;
}

let configuration: AxleConfiguration = {};

export function configureAxle(options: AxleConfiguration): void {
  configuration = { ...configuration, ...options };
}

export function getAxleConfiguration(): AxleConfiguration {
  return { ...configuration };
}
