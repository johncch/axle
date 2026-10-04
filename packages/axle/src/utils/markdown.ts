import chalk from "chalk";
import { marked, type Token, type Tokens } from "marked";

/** Render markdown as ANSI-styled terminal text. */
export function renderTerminalMarkdown(text: string): string {
  return renderBlockTokens(marked.lexer(text), "\n\n");
}

function renderBlockTokens(tokens: Token[] = [], separator: string): string {
  const rendered = tokens.map((token) => renderBlockToken(token)).filter((part) => part.length > 0);
  return rendered.join(separator);
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
      return prefixLines(renderBlockTokens(token.tokens, "\n\n"), chalk.dim("> "));
    case "code":
      return prefixLines(token.text, chalk.dim("│ "));
    case "list":
      return isListToken(token) ? renderList(token) : token.raw;
    case "hr":
      return chalk.dim("─".repeat(40));
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
  const itemSeparator = token.loose ? "\n\n" : "\n";
  return token.items
    .map((item, index) => {
      const marker = token.ordered ? `${Number(token.start || 1) + index}. ` : "- ";
      const checkbox = item.task ? `[${item.checked ? "x" : " "}] ` : "";
      const body = renderBlockTokens(item.tokens, itemSeparator).trimEnd();
      return marker + checkbox + indentContinuation(body, marker.length + checkbox.length);
    })
    .join(itemSeparator);
}

function renderTable(token: Tokens.Table): string {
  const header = token.header.map((cell) => renderInlineTokens(cell.tokens));
  const rows = token.rows.map((row) => row.map((cell) => renderInlineTokens(cell.tokens)));
  const widths = header.map((cell, column) =>
    Math.max(visibleWidth(cell), ...rows.map((row) => visibleWidth(row[column] ?? ""))),
  );
  const line = (cells: string[]) =>
    cells
      .map((cell, column) => padEnd(cell, widths[column]))
      .join("  ")
      .trimEnd();
  const rule = widths.map((width) => "─".repeat(width)).join("  ");
  return [chalk.bold(line(header)), chalk.dim(rule), ...rows.map(line)].join("\n");
}

function visibleWidth(text: string): number {
  return text.replace(/\u001b\[[0-9;]*m/g, "").length;
}

function padEnd(text: string, width: number): string {
  return text + " ".repeat(Math.max(0, width - visibleWidth(text)));
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
  return [first, ...rest.map((line) => (line.length > 0 ? indent + line : line))].join("\n");
}

function decodeEntities(text: string): string {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}
