import { marked } from "marked";
import { markedTerminal } from "marked-terminal";
import type { EventLevel, SpanData, SpanEvent, TraceWriter } from "../types.js";

const levelOrder: Record<EventLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

let markedInitialized = false;
function ensureMarkedInit() {
  if (markedInitialized) return;
  marked.use(markedTerminal() as any);
  markedInitialized = true;
}

export interface SimpleWriterOptions {
  /** Minimum event level to display (default: "info") */
  minLevel?: EventLevel;
  /** Show internal spans - typically enabled via --debug flag (default: false) */
  showInternal?: boolean;
  /** Show timestamps (default: true) */
  showTimestamp?: boolean;
  /** Show duration on span end (default: true) */
  showDuration?: boolean;
  /** Render markdown in event messages that have markdown: true attribute (default: false) */
  markdown?: boolean;
  /** Custom output function (default: console.log) */
  output?: (line: string) => void;
}

export class SimpleWriter implements TraceWriter {
  private minLevel: EventLevel;
  private showInternal: boolean;
  private showTimestamp: boolean;
  private showDuration: boolean;
  private markdown: boolean;
  private output: (line: string) => void;

  // Track span hierarchy for depth calculation and event bubbling
  private spans: Map<string, SpanData> = new Map();
  private visibleDepths: Map<string, number> = new Map();

  constructor(options: SimpleWriterOptions = {}) {
    this.minLevel = options.minLevel ?? "info";
    this.showInternal = options.showInternal ?? false;
    this.showTimestamp = options.showTimestamp ?? true;
    this.showDuration = options.showDuration ?? true;
    this.markdown = options.markdown ?? false;
    this.output = options.output ?? console.log;
  }

  private shouldShowEvent(level: EventLevel): boolean {
    return levelOrder[level] >= levelOrder[this.minLevel];
  }

  private isSpanVisible(span: SpanData): boolean {
    // Internal spans are hidden unless showInternal is true
    if (span.type === "internal" && !this.showInternal) {
      return false;
    }
    return true;
  }

  /**
   * Find the nearest visible ancestor span for a given span.
   * Returns null if no visible ancestor exists (root level).
   */
  private findVisibleAncestor(span: SpanData): SpanData | null {
    let currentId = span.parentSpanId;
    while (currentId) {
      const parent = this.spans.get(currentId);
      if (!parent) break;
      if (this.isSpanVisible(parent)) {
        return parent;
      }
      currentId = parent.parentSpanId;
    }
    return null;
  }

  /**
   * Calculate the visible depth for a span.
   * Only counts visible ancestors in the depth.
   */
  private calculateVisibleDepth(span: SpanData): number {
    if (!this.isSpanVisible(span)) {
      // Hidden spans don't have their own depth, but we still track them
      return -1;
    }

    const visibleAncestor = this.findVisibleAncestor(span);
    if (!visibleAncestor) {
      return 0;
    }

    const ancestorDepth = this.visibleDepths.get(visibleAncestor.spanId) ?? 0;
    return ancestorDepth + 1;
  }

  private formatTimestamp(): string {
    if (!this.showTimestamp) return "";
    const now = new Date();
    const time = now.toTimeString().slice(0, 8);
    const ms = now.getMilliseconds().toString().padStart(3, "0");
    return `[${time}.${ms}] `;
  }

  private formatDuration(span: SpanData): string {
    if (!this.showDuration || !span.endTime) return "";
    const duration = span.endTime - span.startTime;
    if (duration < 1000) {
      return ` (${Math.round(duration)}ms)`;
    }
    return ` (${(duration / 1000).toFixed(2)}s)`;
  }

  private formatIndent(depth: number): string {
    return "  ".repeat(depth);
  }

  private formatSpanName(span: SpanData): string {
    if (span.type) {
      return `[${span.type}] ${span.name}`;
    }
    return span.name;
  }

  private renderMarkdown(text: string): string {
    ensureMarkedInit();
    return (marked.parse(text) as string).trimEnd();
  }

  onSpanStart(span: SpanData): void {
    // Always track the span for hierarchy
    this.spans.set(span.spanId, span);

    const visible = this.isSpanVisible(span);
    if (!visible) return;

    const depth = this.calculateVisibleDepth(span);
    this.visibleDepths.set(span.spanId, depth);

    const indent = this.formatIndent(depth);
    const timestamp = this.formatTimestamp();
    const name = this.formatSpanName(span);
    this.output(`${timestamp}${indent}START ${name}`);
  }

  onSpanEnd(span: SpanData): void {
    // Update the stored span data
    this.spans.set(span.spanId, span);

    const visible = this.isSpanVisible(span);
    if (!visible) return;

    const depth = this.visibleDepths.get(span.spanId) ?? 0;
    const indent = this.formatIndent(depth);
    const timestamp = this.formatTimestamp();
    const duration = this.formatDuration(span);
    const name = this.formatSpanName(span);
    const status = span.status === "error" ? " [ERROR]" : "";
    this.output(`${timestamp}${indent}END   ${name}${duration}${status}`);

    if (span.result?.kind === "llm") {
      const result = span.result;
      const parts: string[] = [`model=${result.model}`];
      if (result.finishReason) {
        parts.push(`finishReason=${result.finishReason}`);
      }
      if (result.usage) {
        if (result.usage.inputTokens !== undefined) {
          parts.push(`inputTokens=${result.usage.inputTokens}`);
        }
        if (result.usage.outputTokens !== undefined) {
          parts.push(`outputTokens=${result.usage.outputTokens}`);
        }
      }
      this.output(`${timestamp}${indent}  INFO  LLM complete ${parts.join(" ")}`);

      if (this.shouldShowEvent("debug") && result.response.content) {
        const content =
          typeof result.response.content === "string"
            ? result.response.content
            : JSON.stringify(result.response.content, null, 2);

        const contentLines = content.split("\n");
        for (const line of contentLines) {
          this.output(`${timestamp}${indent}  DEBUG   ${line}`);
        }
      }
    }
  }

  onSpanUpdate(span: SpanData): void {
    // Update the stored span data
    this.spans.set(span.spanId, span);
    // SimpleWriter doesn't render updates (no live rewriting)
  }

  onEvent(span: SpanData, event: SpanEvent): void {
    if (!this.shouldShowEvent(event.level)) return;

    // Update stored span
    this.spans.set(span.spanId, span);

    // Find the visible depth for rendering this event
    let depth: number;

    if (this.isSpanVisible(span)) {
      depth = this.visibleDepths.get(span.spanId) ?? 0;
    } else {
      // Bubble up to visible ancestor
      const visibleAncestor = this.findVisibleAncestor(span);
      depth = visibleAncestor ? (this.visibleDepths.get(visibleAncestor.spanId) ?? 0) : 0;
    }

    const indent = this.formatIndent(depth + 1);
    const timestamp = this.formatTimestamp();
    const level = event.level.toUpperCase().padEnd(5);

    const useMarkdown = this.markdown && event.attributes?.markdown === true;
    const attrs = event.attributes
      ? Object.entries(event.attributes).filter(([k]) => k !== "markdown")
      : [];

    let message = event.name;
    if (useMarkdown) {
      message = this.renderMarkdown(message);
    }

    let line = `${timestamp}${indent}${level} ${message}`;

    if (attrs.length > 0) {
      const attrStr = attrs.map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(" ");
      line += ` ${attrStr}`;
    }

    this.output(line);
  }
}
