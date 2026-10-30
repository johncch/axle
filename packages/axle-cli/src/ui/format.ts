import type { ConsoleOutput, Cost } from "@fifthrevision/axle/ui";
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

/**
 * `$0.42`, or `$0.42 (2 unpriced)` when some requests had no price; undefined
 * when none did, so a run with no catalog prices shows no dollar figure.
 */
export function formatCost(cost: Cost): string | undefined {
  if (cost.priced.length === 0) return undefined;
  const dollars = cost.usd > 0 && cost.usd < 0.01 ? "<$0.01" : `$${cost.usd.toFixed(2)}`;
  return cost.unpriced.length > 0 ? `${dollars} (${cost.unpriced.length} unpriced)` : dollars;
}

const COMPACTION_FRACTION = 0.8;

/** `◔ 21%`: context use as a quarter-pie glyph plus percent; filled once compaction is due. */
export function contextPie(fraction: number): string {
  const percent = Math.round(Math.max(0, fraction) * 100);
  const glyph =
    fraction >= COMPACTION_FRACTION
      ? "●"
      : ["○", "◔", "◑", "◕"][Math.min(3, Math.round(fraction * 4))];
  return `${glyph} ${percent}%`;
}

export function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max - 1) + "…" : text;
}

export function wrap(text: string, indent: string, width: number): string[] {
  if (text === "") return [];
  const lines: string[] = [];
  let line = indent;
  for (const word of text.split(" ")) {
    if (line !== indent && line.length + 1 + word.length > width) {
      lines.push(line);
      line = indent;
    }
    line += line === indent ? word : ` ${word}`;
  }
  return [...lines, line];
}

/** A failure as `✖ message`, wrapped to `width` with a list item's text kept aligned. */
export function formatFailure(message: string, width: number): string {
  const lines = message.split("\n").flatMap((line) => {
    const marker = line.match(/^\s*(?:- )?/)?.[0] ?? "";
    const indent = " ".repeat(marker.length);
    const wrapped = wrap(line.slice(marker.length), indent, width - 2);
    return wrapped.map((text, index) => (index === 0 ? marker + text.slice(marker.length) : text));
  });
  return lines.map((line, index) => `${index === 0 ? "✖" : " "} ${line}`).join("\n");
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

export function formatActionResult(result?: {
  type: string;
  content?: unknown;
  error?: { message: string };
}): { text: string; tone: "error" | "dim" } | undefined {
  if (!result) return undefined;
  if (result.type === "error" && result.error) {
    return { text: truncate(result.error.message, 200), tone: "error" };
  }
  const content = result.content;
  if (typeof content === "string") {
    return content.trim() ? { text: truncate(firstLine(content), 200), tone: "dim" } : undefined;
  }
  if (isConsoleOutput(content)) {
    const failed = content.exitCode !== undefined && content.exitCode !== 0;
    const stream = failed && content.stderr?.trim() ? content.stderr : content.stdout;
    const line = stream.trim() ? firstLine(stream) : "";
    const suffix = failed ? ` (exit ${content.exitCode})` : "";
    if (!line && !suffix) return undefined;
    return { text: truncate(`${line}${suffix}`, 200), tone: failed ? "error" : "dim" };
  }
  return undefined;
}

function isConsoleOutput(value: unknown): value is ConsoleOutput {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as ConsoleOutput).stdout === "string"
  );
}

function firstLine(text: string): string {
  return text.trim().split("\n", 1)[0];
}
