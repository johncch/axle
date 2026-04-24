import chalk from "chalk";
import { marked, type Token, type Tokens } from "marked";
import type { EventLevel, SpanData, SpanEvent, TraceWriter } from "../types.js";

const levelOrder: Record<EventLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

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
    return renderTerminalMarkdown(text).trimEnd();
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

function renderTerminalMarkdown(text: string): string {
  return renderBlockTokens(marked.lexer(text));
}

function renderBlockTokens(tokens: Token[] = []): string {
  const rendered = tokens
    .map((token) => renderBlockToken(token))
    .filter((part) => part.length > 0);
  return rendered.join("\n");
}

function renderBlockToken(token: Token): string {
  switch (token.type) {
    case "space":
      return "";
    case "heading":
      return chalk.bold(renderInlineTokens(token.tokens));
    case "paragraph":
      return renderInlineTokens(token.tokens);
    case "blockquote":
      return prefixLines(renderBlockTokens(token.tokens), "> ");
    case "code": {
      const language = token.lang ? chalk.dim(`${token.lang}\n`) : "";
      return language + chalk.yellow(token.text);
    }
    case "list":
      return isListToken(token) ? renderList(token) : token.raw;
    case "hr":
      return chalk.dim("-".repeat(40));
    case "table":
      return isTableToken(token) ? renderTable(token) : token.raw;
    case "html":
      return token.text;
    case "text":
      return token.tokens ? renderInlineTokens(token.tokens) : decodeEntities(token.text);
    default:
      return "tokens" in token && token.tokens ? renderInlineTokens(token.tokens) : token.raw;
  }
}

function renderInlineTokens(tokens: Token[] = []): string {
  return tokens.map((token) => renderInlineToken(token)).join("");
}

function renderInlineToken(token: Token): string {
  switch (token.type) {
    case "text":
    case "escape":
      return decodeEntities(token.text);
    case "strong":
      return chalk.bold(renderInlineTokens(token.tokens));
    case "em":
      return chalk.italic(renderInlineTokens(token.tokens));
    case "codespan":
      return chalk.yellow(token.text);
    case "del":
      return chalk.strikethrough(renderInlineTokens(token.tokens));
    case "link": {
      const label = renderInlineTokens(token.tokens);
      return token.href && token.href !== token.text
        ? `${chalk.blue.underline(label)} ${chalk.dim(`(${token.href})`)}`
        : chalk.blue.underline(label);
    }
    case "image":
      return token.text ? `${token.text} (${token.href})` : token.href;
    case "br":
      return "\n";
    case "html":
      return token.text;
    default:
      return "tokens" in token && token.tokens ? renderInlineTokens(token.tokens) : token.raw;
  }
}

function isListToken(token: Token): token is Tokens.List {
  return token.type === "list" && "items" in token && Array.isArray(token.items);
}

function isTableToken(token: Token): token is Tokens.Table {
  return token.type === "table" && "header" in token && "rows" in token;
}

function renderList(token: Tokens.List): string {
  return token.items
    .map((item, index) => {
      const marker = token.ordered ? `${Number(token.start || 1) + index}. ` : "- ";
      const checkbox = item.task ? `[${item.checked ? "x" : " "}] ` : "";
      const body = renderBlockTokens(item.tokens).trimEnd();
      return marker + checkbox + indentContinuation(body, marker.length + checkbox.length);
    })
    .join("\n");
}

function renderTable(token: Tokens.Table): string {
  const header = token.header.map((cell) => renderInlineTokens(cell.tokens)).join(" | ");
  const rows = token.rows.map((row) =>
    row.map((cell) => renderInlineTokens(cell.tokens)).join(" | "),
  );
  return [chalk.bold(header), ...rows].join("\n");
}

function prefixLines(text: string, prefix: string): string {
  return text
    .split("\n")
    .map((line) => prefix + line)
    .join("\n");
}

function indentContinuation(text: string, width: number): string {
  const [first = "", ...rest] = text.split("\n");
  if (rest.length === 0) return first;
  const indent = " ".repeat(width);
  return [first, ...rest.map((line) => indent + line)].join("\n");
}

function decodeEntities(text: string): string {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}
