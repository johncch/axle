export function capitalize(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

export function formatDuration(timing?: { start: string; end?: string }): string | undefined {
  if (!timing?.end) return undefined;
  const ms = Date.parse(timing.end) - Date.parse(timing.start);
  if (!Number.isFinite(ms) || ms < 0) return undefined;
  return formatMs(ms);
}

export function formatMs(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
}

export function formatTokens(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}k`;
  return String(count);
}

export function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max - 1) + "…" : text;
}

export function indentContinuation(text: string): string {
  return text.split("\n").join("\n  ");
}

export function formatActionArgs(part: { kind: string; detail: object }): string | undefined {
  if (part.kind !== "tool") return undefined;
  const parameters = (part.detail as { parameters?: Record<string, unknown> }).parameters ?? {};
  if (Object.keys(parameters).length === 0) return undefined;
  return truncate(JSON.stringify(parameters), 80);
}
