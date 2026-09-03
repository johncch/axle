import type { ActionPart, Turn, TurnPart } from "@fifthrevision/axle/ui";
import { Box, Static, Text, useInput } from "ink";
import { useEffect, useState, useSyncExternalStore } from "react";
import { capitalize, formatDuration, formatTokens, truncate } from "../format.js";
import type { SessionUsage } from "../renderer.js";
import type { StaticItem, UiStore } from "./store.js";

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const LIVE_TAIL_LINES = 6;

export function App({
  store,
  onSubmit,
}: {
  store: UiStore;
  onSubmit: (value: string | null) => void;
}) {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);

  return (
    <>
      <Static items={state.staticItems}>
        {(item, index) => <StaticItemView key={index} item={item} />}
      </Static>
      {state.liveTurn && <LiveRegion turn={state.liveTurn} />}
      {state.queuedInputs.map((queued, index) => (
        <Text key={index} dimColor>
          {"\u276f "}
          {queued} (queued)
        </Text>
      ))}
      {!state.closed && (
        <InputLine
          onSubmit={onSubmit}
          awaitingInput={state.awaitingInput}
          onInterrupt={state.onInterrupt}
        />
      )}
      {!state.closed && state.usage && <UsageBar usage={state.usage} />}
    </>
  );
}

function UsageBar({ usage }: { usage: SessionUsage }) {
  const context = usage.contextLimit
    ? `${contextBar(usage.contextTokens / usage.contextLimit)} ~${formatTokens(usage.contextTokens)}tok`
    : `ctx ~${formatTokens(usage.contextTokens)}`;
  return (
    <Text dimColor>
      {"  "}↑ {formatTokens(usage.in)} ↓ {formatTokens(usage.out)} · {context}
    </Text>
  );
}

const CONTEXT_BAR_CELLS = 8;

function contextBar(fraction: number): string {
  const filled = Math.min(CONTEXT_BAR_CELLS, Math.round(fraction * CONTEXT_BAR_CELLS));
  return "█".repeat(filled) + "░".repeat(CONTEXT_BAR_CELLS - filled);
}

/**
 * Chat input, always mounted — it keeps the terminal in raw mode for the
 * whole session, so Ctrl-C is always a key event here (a real SIGINT would
 * also hit ancestor processes like pnpm/tsx and kill the tree). At rest,
 * Ctrl-C ends the chat; during a turn it routes to the interrupt handler.
 * Submitting during a turn queues the line for the next prompt.
 */
function InputLine({
  onSubmit,
  awaitingInput,
  onInterrupt,
}: {
  onSubmit: (value: string | null) => void;
  awaitingInput: boolean;
  onInterrupt?: () => void;
}) {
  const [value, setValue] = useState("");

  const submit = (text: string) => {
    setValue("");
    onSubmit(text);
  };

  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      if (awaitingInput) {
        onSubmit(null);
      } else {
        onInterrupt?.();
      }
      return;
    }
    if (key.ctrl && input === "d") {
      if (awaitingInput && value === "") onSubmit(null);
      return;
    }
    if (key.return) {
      // Shift/Alt-Enter arrives as a modified return only in terminals that
      // send one (VSCode, iTerm2 with a mapping, kitty); plain Enter submits.
      if (key.shift || key.meta) {
        setValue((v) => v + "\n");
        return;
      }
      submit(value);
      return;
    }
    if (key.backspace || key.delete) {
      setValue((v) => v.slice(0, -1));
      return;
    }
    if (key.ctrl && input === "u") {
      setValue("");
      return;
    }
    if (input && !key.ctrl && !key.meta) {
      // A paste arrives as one chunk (key.return only fires for a lone Enter
      // keypress); keep its newlines in the value instead of submitting.
      setValue((v) => v + input.replace(/\r\n?/g, "\n"));
    }
  });

  // Invisible until the prompt is live or the user starts typing ahead \u2014
  // non-interactive runs keep the input mounted (raw mode, Ctrl-C handling)
  // without showing a prompt they can't use.
  if (!awaitingInput && value === "") return null;

  return (
    <Box marginTop={1}>
      <Text>
        <Text color="cyan">{"\u276f "}</Text>
        {indentContinuation(value)}
        <Text inverse> </Text>
      </Text>
    </Box>
  );
}

export const HOST_MARKS = {
  info: { glyph: "\u2139", color: "cyan" },
  success: { glyph: "\u2714", color: "green" },
  warn: { glyph: "\u26a0", color: "yellow" },
  error: { glyph: "\u2716", color: "red" },
} as const;

export function HostLine({ level, text }: { level: keyof typeof HOST_MARKS; text: string }) {
  const mark = HOST_MARKS[level];
  return (
    <Text>
      <Text color={mark.color}>{mark.glyph}</Text> {indentContinuation(text)}
    </Text>
  );
}

function StaticItemView({ item }: { item: StaticItem }) {
  if (item.kind === "host") {
    return <HostLine level={item.level} text={item.text} />;
  }
  return <TurnView turn={item.turn} />;
}

function LiveRegion({ turn }: { turn: Turn }) {
  const frame = useSpinner();
  if (turn.parts.length === 0) {
    return <Text color="cyan">{frame}</Text>;
  }
  return <TurnView turn={turn} live spinnerFrame={frame} />;
}

export function useSpinner(): string {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 80);
    return () => clearInterval(timer);
  }, []);
  return SPINNER_FRAMES[tick % SPINNER_FRAMES.length];
}

function TurnView({
  turn,
  live,
  spinnerFrame,
}: {
  turn: Turn;
  live?: boolean;
  spinnerFrame?: string;
}) {
  return (
    <Box flexDirection="column">
      {turn.parts.map((part, index) => (
        <PartView
          key={part.id}
          part={part}
          owner={turn.owner}
          live={live}
          spinner={index === turn.parts.length - 1 ? spinnerFrame : undefined}
        />
      ))}
      {turn.error && <Text color="red">✖ {turn.error.message}</Text>}
    </Box>
  );
}

function PartView({
  part,
  owner,
  live,
  spinner,
}: {
  part: TurnPart;
  owner: Turn["owner"];
  live?: boolean;
  spinner?: string;
}) {
  switch (part.type) {
    case "text": {
      if (!part.text) {
        return spinner ? <Text color="cyan">{spinner}</Text> : null;
      }
      const text = live ? lastLines(part.text, LIVE_TAIL_LINES) : part.text.trim();
      if (owner === "user") {
        return (
          <Text>
            {"\u276f "}
            {indentContinuation(text)}
          </Text>
        );
      }
      return <Text>{text}</Text>;
    }

    case "thinking": {
      if (spinner) {
        return (
          <Text>
            <Text color="cyan">{spinner}</Text> <Text dimColor>Thinking…</Text>
          </Text>
        );
      }
      const duration = formatDuration(part.timing);
      const summary = part.summary?.trim();
      return (
        <Text dimColor>
          ✔ Thinking{duration ? ` (${duration})` : ""}
          {summary ? ` — ${summary}` : ""}
        </Text>
      );
    }

    case "action":
      return <ActionView part={part} live={live} spinner={spinner} />;

    case "citation":
      return (
        <Box flexDirection="column">
          {part.citations.map((citation, index) => {
            const source = citation.source as { title?: string; url?: string; uri?: string };
            return (
              <Text key={index} dimColor>
                ※ {source.title ?? source.url ?? source.uri ?? citation.source.type}
              </Text>
            );
          })}
        </Box>
      );

    case "file":
      return (
        <Text dimColor>
          ▣ {part.file.name} ({part.file.mimeType})
        </Text>
      );

    case "compaction": {
      if (part.status === "error") {
        return <Text color="red">✖ Compaction failed: {part.error}</Text>;
      }
      if (part.status === "running") {
        const percent = part.progress !== undefined ? ` ${Math.round(part.progress * 100)}%` : "";
        return (
          <Text>
            <Text color="cyan">{spinner ?? SPINNER_FRAMES[0]}</Text>{" "}
            <Text dimColor>
              Compacting…
              {percent}
            </Text>
          </Text>
        );
      }
      const duration = formatDuration(part.timing);
      return (
        <Text>
          <Text color="green">✔</Text> Compacted context
          {duration && <Text dimColor> ({duration})</Text>}
        </Text>
      );
    }
  }
}

function ActionView({
  part,
  live,
  spinner,
}: {
  part: ActionPart;
  live?: boolean;
  spinner?: string;
}) {
  const running = part.status === "pending" || part.status === "running";
  const glyph = running
    ? (spinner ?? "\u280b")
    : part.status === "complete"
      ? "\u2714"
      : part.status === "error"
        ? "\u2716"
        : "\u26a0";
  const color = running
    ? "cyan"
    : part.status === "complete"
      ? "green"
      : part.status === "error"
        ? "red"
        : "yellow";

  const args =
    part.kind === "tool" && Object.keys(part.detail.parameters).length > 0
      ? truncate(JSON.stringify(part.detail.parameters), 80)
      : undefined;
  const duration = running || part.status === "cancelled" ? undefined : formatDuration(part.timing);

  return (
    <Box flexDirection="column">
      <Text>
        <Text color={color}>{glyph}</Text> {capitalize(part.detail.name)}
        {args && <Text dimColor> {args}</Text>}
        {duration && <Text dimColor> ({duration})</Text>}
        {part.status === "cancelled" && <Text dimColor> (cancelled)</Text>}
      </Text>
      <ActionResultView result={part.detail.result} />
      {part.kind === "agent" && part.detail.children.length > 0 && (
        <Box flexDirection="column" paddingLeft={2}>
          {part.detail.children.map((child) => (
            <TurnView key={child.id} turn={child} live={live} />
          ))}
        </Box>
      )}
    </Box>
  );
}

function ActionResultView({
  result,
}: {
  result?: { type: string; content?: unknown; error?: { message: string } };
}) {
  if (!result) return null;
  if (result.type === "error" && result.error) {
    return <Text color="red"> {truncate(result.error.message, 200)}</Text>;
  }
  const content = typeof result.content === "string" ? result.content : undefined;
  if (!content?.trim()) return null;
  return <Text dimColor> {truncate(firstLine(content), 200)}</Text>;
}

function indentContinuation(text: string): string {
  return text.split("\n").join("\n  ");
}

function lastLines(text: string, count: number): string {
  const lines = text.trimEnd().split("\n");
  return lines.slice(-count).join("\n");
}

function firstLine(text: string): string {
  return text.trim().split("\n", 1)[0];
}
