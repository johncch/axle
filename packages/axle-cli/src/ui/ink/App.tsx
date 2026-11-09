import {
  renderTerminalMarkdown,
  type ActionPart,
  type Turn,
  type TurnPart,
} from "@fifthrevision/axle/ui";
import { Box, Static, Text, useInput, type Key } from "ink";
import { useEffect, useState, useSyncExternalStore } from "react";
import {
  capitalize,
  contextPie,
  formatActionArgs,
  formatActionResult,
  formatCost,
  formatDuration,
  formatTokens,
  indentContinuation,
} from "../format.js";
import type { SessionUsage } from "../renderer.js";
import {
  deleteBackward,
  deleteForward,
  deleteToLineStart,
  deleteWordBackward,
  EMPTY_INPUT_BUFFER,
  insertText,
  moveDown,
  moveLeft,
  moveRight,
  moveToLineEnd,
  moveToLineStart,
  moveUp,
  moveWordLeft,
  moveWordRight,
  type InputBuffer,
} from "./input-buffer.js";
import type { StaticItem, UiStore } from "./store.js";

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const LIVE_TAIL_LINES = 6;

export function App({
  store,
  onSubmit,
  statusBar,
}: {
  store: UiStore;
  onSubmit: (value: string | null) => void;
  statusBar: boolean;
}) {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const busy = state.liveTurn !== undefined || state.pending.length > 0;

  return (
    <>
      <Static items={state.staticItems}>
        {(item, index) => <StaticItemView key={index} item={item} />}
      </Static>
      {state.liveTurn && <LiveRegion turn={state.liveTurn} />}
      {state.pending.map((turn) => (
        <Text key={turn.id} dimColor>
          {pendingLabel(turn)} (queued)
        </Text>
      ))}
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
          atIdlePrompt={state.awaitingInput && !busy}
          onInterrupt={state.onInterrupt}
        />
      )}
      {statusBar && !state.closed && state.usage && <UsageBar usage={state.usage} />}
    </>
  );
}

function pendingLabel(turn: Turn): string {
  if (turn.parts.some((part) => part.type === "compaction")) return "Compaction";
  const text = turn.parts.find((part) => part.type === "text")?.text ?? "";
  return `\u276f ${text}`;
}

function UsageBar({ usage }: { usage: SessionUsage }) {
  const context = usage.contextLimit
    ? contextPie(usage.contextTokens / usage.contextLimit)
    : `ctx ~${formatTokens(usage.contextTokens)}`;
  const cost = formatCost(usage.cost);
  return (
    <Text dimColor>
      {"  "}↑ {formatTokens(usage.usage.in)} ↓ {formatTokens(usage.usage.out)}
      {cost ? ` · ${cost}` : ""} {context}
    </Text>
  );
}

function InputLine({
  onSubmit,
  awaitingInput,
  atIdlePrompt,
  onInterrupt,
}: {
  onSubmit: (value: string | null) => void;
  awaitingInput: boolean;
  atIdlePrompt: boolean;
  onInterrupt?: () => void;
}) {
  const [buffer, setBuffer] = useState(EMPTY_INPUT_BUFFER);

  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      if (atIdlePrompt) {
        onSubmit(null);
      } else {
        onInterrupt?.();
      }
      return;
    }
    if (key.ctrl && input === "d") {
      if (atIdlePrompt && buffer.text === "") onSubmit(null);
      return;
    }
    if (key.return) {
      // Shift/Alt-Enter arrives as a modified return only in terminals that
      // send one (VSCode, iTerm2 with a mapping, kitty); plain Enter submits.
      if (key.shift || key.meta) {
        setBuffer((current) => insertText(current, "\n"));
        return;
      }
      setBuffer(EMPTY_INPUT_BUFFER);
      onSubmit(buffer.text);
      return;
    }

    const edit = editForKey(input, key);
    if (edit) {
      setBuffer(edit);
      return;
    }
    if (input && !key.ctrl && !key.meta && !key.super) {
      // A paste arrives as one chunk (key.return only fires for a lone Enter
      // keypress); keep its newlines in the value instead of submitting.
      const pasted = input.replace(/\r\n?/g, "\n");
      setBuffer((current) => insertText(current, pasted));
    }
  });

  // Invisible until the prompt is live or the user starts typing ahead \u2014
  // non-interactive runs keep the input mounted (raw mode, Ctrl-C handling)
  // without showing a prompt they can't use.
  if (!awaitingInput && buffer.text === "") return null;

  const underCursor = buffer.text[buffer.cursor];
  const cursorOnCharacter = underCursor !== undefined && underCursor !== "\n";
  const afterCursor = buffer.text.slice(cursorOnCharacter ? buffer.cursor + 1 : buffer.cursor);

  return (
    <Box marginTop={1}>
      <Text>
        <Text color="cyan">{"\u276f "}</Text>
        {indentContinuation(buffer.text.slice(0, buffer.cursor))}
        <Text inverse>{cursorOnCharacter ? underCursor : " "}</Text>
        {indentContinuation(afterCursor)}
      </Text>
    </Box>
  );
}

// Cmd and Option reach us as whatever the terminal maps them to: Cmd-Left is
// Ctrl-A or Home, Option-Left is Esc-b or a meta arrow, Option-Backspace is
// Esc-DEL or Ctrl-W, Cmd-Backspace is Ctrl-U. Under the kitty keyboard
// protocol Cmd arrives as `super` instead.
function editForKey(input: string, key: Key): ((buffer: InputBuffer) => InputBuffer) | undefined {
  if (key.leftArrow) {
    if (key.super) return moveToLineStart;
    return key.meta || key.ctrl ? moveWordLeft : moveLeft;
  }
  if (key.rightArrow) {
    if (key.super) return moveToLineEnd;
    return key.meta || key.ctrl ? moveWordRight : moveRight;
  }
  if (key.upArrow) return moveUp;
  if (key.downArrow) return moveDown;
  if (key.home) return moveToLineStart;
  if (key.end) return moveToLineEnd;
  if (key.backspace) {
    if (key.super) return deleteToLineStart;
    return key.meta ? deleteWordBackward : deleteBackward;
  }
  if (key.delete) return deleteForward;
  if (key.meta && input === "b") return moveWordLeft;
  if (key.meta && input === "f") return moveWordRight;
  if (key.ctrl && input === "a") return moveToLineStart;
  if (key.ctrl && input === "e") return moveToLineEnd;
  if (key.ctrl && input === "w") return deleteWordBackward;
  if (key.ctrl && input === "u") return deleteToLineStart;
  return undefined;
}

export const RUNNER_LINE_MARKS = {
  info: { glyph: "\u2139", color: "cyan" },
  success: { glyph: "\u2714", color: "green" },
  warn: { glyph: "\u26a0", color: "yellow" },
  error: { glyph: "\u2716", color: "red" },
} as const;

export function RunnerLine({
  level,
  text,
}: {
  level: keyof typeof RUNNER_LINE_MARKS;
  text: string;
}) {
  const mark = RUNNER_LINE_MARKS[level];
  return (
    <Text>
      <Text color={mark.color}>{mark.glyph}</Text> {indentContinuation(text)}
    </Text>
  );
}

function StaticItemView({ item }: { item: StaticItem }) {
  if (item.kind === "runner") {
    return <RunnerLine level={item.level} text={item.text} />;
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
      {turn.reason === "length" && (
        <Text>
          <Text color="yellow">⚠</Text> Stopped at the output token limit
        </Text>
      )}
      {turn.failure && <Text color="red">✖ {turn.failure.message}</Text>}
      {turn.status === "cancelled" && <Text dimColor>(interrupted)</Text>}
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
      if (owner === "user") {
        const text = live ? lastLines(part.text, LIVE_TAIL_LINES) : part.text.trim();
        return (
          <Text>
            {"\u276f "}
            {indentContinuation(text)}
          </Text>
        );
      }
      const rendered = renderTerminalMarkdown(part.text).trimEnd();
      return <Text>{live ? lastLines(rendered, LIVE_TAIL_LINES) : rendered}</Text>;
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
      const summary = part.summary ? renderTerminalMarkdown(part.summary).trimEnd() : "";
      return (
        <Text dimColor>
          ✔ Thinking{duration ? ` (${duration})` : ""}
          {summary ? ` — ${indentContinuation(summary)}` : ""}
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
      if (part.status === "cancelled") {
        return (
          <Text>
            <Text color="yellow">⚠</Text> Compaction<Text dimColor> (cancelled)</Text>
          </Text>
        );
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

  const args = formatActionArgs(part);
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
  const formatted = formatActionResult(result);
  if (!formatted) return null;
  if (formatted.tone === "error") return <Text color="red"> {formatted.text}</Text>;
  return <Text dimColor> {formatted.text}</Text>;
}

// Called on every streaming re-render, so it scans backward for the last N
// newlines instead of splitting the whole accumulated text each frame.
function lastLines(text: string, count: number): string {
  const trimmed = text.trimEnd();
  let index = trimmed.length;
  for (let i = 0; i < count; i++) {
    const next = trimmed.lastIndexOf("\n", index - 1);
    if (next === -1) return trimmed;
    index = next;
  }
  return trimmed.slice(index + 1);
}
