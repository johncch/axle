import {
  renderTerminalMarkdown,
  type ActionPart,
  type Turn,
  type TurnPart,
} from "@fifthrevision/axle/ui";
import { Box, Static, Text, useInput, usePaste, useWindowSize, type Key } from "ink";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import wrapAnsi from "wrap-ansi";
import { loadImageFile, readClipboardImage } from "../clipboard.js";
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
import { DISPLAY_METADATA_KEY, type ChatInput, type SessionUsage } from "../renderer.js";
import {
  decodeBase64Image,
  nextPlaceholder,
  pastedImagePath,
  placeholderLabels,
  renderPlaceholders,
  resolveInput,
  shouldCollapse,
  stripReserved,
  type Attachment,
} from "./attachments.js";
import {
  applyEdit,
  deleteBackward,
  deleteForward,
  deleteToLineStart,
  deleteWordBackward,
  EMPTY_INPUT_HISTORY,
  insertText,
  moveDown,
  moveLeft,
  moveRight,
  moveToLineEnd,
  moveToLineStart,
  moveUp,
  moveWordLeft,
  moveWordRight,
  redo,
  undo,
  type InputBuffer,
} from "./input-buffer.js";
import type { StaticItem, UiStore } from "./store.js";

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const MIN_LIVE_TAIL_ROWS = 6;
const MAX_LIVE_TAIL_ROWS = 20;
const CHILD_TURN_INDENT = 2;

const UserMessageBackground = createContext<string | undefined>(undefined);

/** Where the chat input gets images from; replaceable in tests. */
export interface ImageSources {
  readClipboard: typeof readClipboardImage;
  loadFile: typeof loadImageFile;
}

const SYSTEM_IMAGE_SOURCES: ImageSources = {
  readClipboard: readClipboardImage,
  loadFile: loadImageFile,
};

const NOTICES = {
  imagesNotAccepted: "This model does not accept images",
  noClipboardImage: "No image on the clipboard",
  clipboardUnsupported: "Reading an image from the clipboard is only supported on macOS",
  tooManyAttachments: "Too many attachments in one message",
};

export function App({
  store,
  onSubmit,
  statusBar,
  userMessageBackground,
  imageSources = SYSTEM_IMAGE_SOURCES,
}: {
  store: UiStore;
  onSubmit: (value: ChatInput | null) => void;
  statusBar: boolean;
  /** Fill drawn behind a user message in the transcript; none when undefined. */
  userMessageBackground?: string;
  imageSources?: ImageSources;
}) {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const busy = state.liveTurn !== undefined || state.pending.length > 0;

  return (
    <UserMessageBackground value={userMessageBackground}>
      <Static items={state.staticItems}>
        {(item, index) => (
          <StaticItemView key={index} item={item} previous={state.staticItems[index - 1]} />
        )}
      </Static>
      {state.liveTurn && <LiveRegion turn={state.liveTurn} continues={state.liveContinues} />}
      {state.pending.map((turn) => (
        <Text key={turn.id} dimColor>
          {pendingLabel(turn)} (queued)
        </Text>
      ))}
      {state.queuedInputs.map((queued, index) => (
        <Text key={index} dimColor>
          {"\u276f "}
          {queued.display ?? queued.text} (queued)
        </Text>
      ))}
      {!state.closed && (
        <InputLine
          onSubmit={onSubmit}
          awaitingInput={state.awaitingInput}
          atIdlePrompt={state.awaitingInput && !busy}
          onInterrupt={state.onInterrupt}
          imageInput={state.imageInput}
          imageSources={imageSources}
        />
      )}
      {statusBar && !state.closed && state.usage && <UsageBar usage={state.usage} />}
    </UserMessageBackground>
  );
}

function pendingLabel(turn: Turn): string {
  if (turn.parts.some((part) => part.type === "compaction")) return "Compaction";
  const text = displayText(turn) ?? turn.parts.find((part) => part.type === "text")?.text ?? "";
  return `\u276f ${text}`;
}

function displayText(turn: Turn): string | undefined {
  const display = turn.metadata?.[DISPLAY_METADATA_KEY];
  return turn.owner === "user" && typeof display === "string" ? display : undefined;
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
  imageInput,
  imageSources,
}: {
  onSubmit: (value: ChatInput | null) => void;
  awaitingInput: boolean;
  atIdlePrompt: boolean;
  onInterrupt?: () => void;
  imageInput?: boolean;
  imageSources: ImageSources;
}) {
  const [history, setHistory] = useState(EMPTY_INPUT_HISTORY);
  const [notice, setNotice] = useState<string>();
  const attachments = useRef(new Map<string, Attachment>());
  const buffer = history.current;

  const insert = (inserted: string) => {
    setHistory((current) => applyEdit(current, (b) => insertText(b, inserted), "other"));
  };
  const attach = (attachment: Attachment) => {
    const placeholder = nextPlaceholder(attachments.current);
    if (!placeholder) {
      setNotice(NOTICES.tooManyAttachments);
      return;
    }
    attachments.current.set(placeholder, attachment);
    insert(placeholder);
  };
  const attachClipboardImage = async () => {
    if (imageInput === false) {
      setNotice(NOTICES.imagesNotAccepted);
      return;
    }
    const clipboard = await imageSources.readClipboard();
    if (clipboard.status === "image") {
      attach({ kind: "image", file: clipboard.file });
    } else {
      setNotice(
        clipboard.status === "none" ? NOTICES.noClipboardImage : NOTICES.clipboardUnsupported,
      );
    }
  };
  const handlePaste = async (pasted: string) => {
    const text = stripReserved(pasted.replace(/\r\n?/g, "\n"));
    if (text === "") {
      await attachClipboardImage();
      return;
    }
    const encoded = decodeBase64Image(text);
    const path = encoded ? undefined : pastedImagePath(text);
    if (encoded || path) {
      if (imageInput === false) {
        setNotice(NOTICES.imagesNotAccepted);
        if (path) insert(text);
        return;
      }
      const file = encoded ?? (path ? await imageSources.loadFile(path) : undefined);
      if (file) {
        attach({ kind: "image", file });
        return;
      }
    }
    if (shouldCollapse(text)) {
      attach({ kind: "paste", text });
    } else {
      insert(text);
    }
  };

  usePaste((pasted) => {
    setNotice(undefined);
    void handlePaste(pasted);
  });

  useInput((input, key) => {
    setNotice(undefined);
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
    // Ctrl-J is a raw line feed that inserts itself as text, except under the
    // kitty keyboard protocol, where it arrives as ctrl + "j".
    const kittyCtrlJ = key.ctrl && input === "j";
    if (key.return || kittyCtrlJ) {
      if (key.shift || key.meta || kittyCtrlJ) {
        setHistory((current) => applyEdit(current, (b) => insertText(b, "\n"), "other"));
        return;
      }
      const submitted = resolveInput(buffer.text, attachments.current);
      attachments.current = new Map();
      setHistory(EMPTY_INPUT_HISTORY);
      onSubmit(submitted);
      return;
    }

    if (key.ctrl && input === "v") {
      void attachClipboardImage();
      return;
    }

    if ((key.super || key.ctrl) && input === "z") {
      setHistory(key.shift ? redo : undo);
      return;
    }

    const edit = editForKey(input, key);
    if (edit) {
      setHistory((current) => applyEdit(current, edit, "other"));
      return;
    }
    if (input && !key.ctrl && !key.meta && !key.super) {
      // A terminal without bracketed paste delivers a paste here as one chunk
      // (key.return only fires for a lone Enter keypress); keep its newlines
      // in the value instead of submitting.
      const inserted = stripReserved(input.replace(/\r\n?/g, "\n"));
      const change = inserted.length === 1 ? "typing" : "other";
      setHistory((current) => applyEdit(current, (b) => insertText(b, inserted), change));
    }
  });

  // Invisible until the prompt is live or the user starts typing ahead \u2014
  // non-interactive runs keep the input mounted (raw mode, Ctrl-C handling)
  // without showing a prompt they can't use.
  if (!awaitingInput && buffer.text === "" && !notice) return null;

  const labels = placeholderLabels(buffer.text, attachments.current);
  const shown = (text: string) => indentContinuation(renderPlaceholders(text, labels));
  const underCursor = buffer.text[buffer.cursor];
  const cursorOnCharacter = underCursor !== undefined && underCursor !== "\n";
  const afterCursor = buffer.text.slice(cursorOnCharacter ? buffer.cursor + 1 : buffer.cursor);

  return (
    <Box marginTop={1} flexDirection="column">
      <Text>
        <Text color="cyan">{"\u276f "}</Text>
        {shown(buffer.text.slice(0, buffer.cursor))}
        <Text inverse>{cursorOnCharacter ? shown(underCursor) : " "}</Text>
        {shown(afterCursor)}
      </Text>
      {notice && (
        <Text>
          <Text color="yellow">⚠</Text> {notice}
        </Text>
      )}
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

/** Present while a turn streams: the columns it is drawn in and the rows its text may take. */
interface LiveFrame {
  width: number;
  tailRows: number;
}

function StaticItemView({ item, previous }: { item: StaticItem; previous?: StaticItem }) {
  const { columns } = useWindowSize();
  if (item.kind === "runner") {
    return <RunnerLine level={item.level} text={item.text} />;
  }
  if (item.turn.owner === "user") {
    const followsUser = previous?.kind === "turn" && previous.turn.owner === "user";
    return (
      <Box flexDirection="column" width={columns} marginTop={followsUser ? 0 : 1} marginBottom={1}>
        <TurnView turn={item.turn} />
      </Box>
    );
  }
  if (item.continues) {
    return (
      <Box marginTop={1}>
        <TurnView turn={item.turn} />
      </Box>
    );
  }
  return <TurnView turn={item.turn} />;
}

function LiveRegion({ turn, continues }: { turn: Turn; continues?: boolean }) {
  const frame = useSpinner();
  const { columns, rows } = useWindowSize();
  if (turn.parts.length === 0) {
    return <Text color="cyan">{frame}</Text>;
  }
  const tailRows = Math.max(MIN_LIVE_TAIL_ROWS, Math.min(MAX_LIVE_TAIL_ROWS, Math.floor(rows / 2)));
  return (
    <Box marginTop={continues ? 1 : 0}>
      <TurnView turn={turn} live={{ width: columns, tailRows }} spinnerFrame={frame} />
    </Box>
  );
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
  live?: LiveFrame;
  spinnerFrame?: string;
}) {
  const display = displayText(turn);
  const displayPart = display ? turn.parts.find((part) => part.type === "text") : undefined;
  return (
    <Box flexDirection="column">
      {turn.parts.map((part, index) => (
        <PartView
          key={part.id}
          part={part === displayPart && display ? { ...part, text: display } : part}
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
  live?: LiveFrame;
  spinner?: string;
}) {
  const userMessageBackground = useContext(UserMessageBackground);
  switch (part.type) {
    case "text": {
      if (!part.text) {
        return spinner ? <Text color="cyan">{spinner}</Text> : null;
      }
      if (owner === "user") {
        return (
          <Box backgroundColor={userMessageBackground}>
            <Text>
              <Text dimColor>{"\u276f"}</Text> {indentContinuation(part.text.trim())}
            </Text>
          </Box>
        );
      }
      const rendered = renderTerminalMarkdown(part.text).trimEnd();
      return <Text>{live ? lastRows(rendered, live.tailRows, live.width) : rendered}</Text>;
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
  live?: LiveFrame;
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
        <Box flexDirection="column" paddingLeft={CHILD_TURN_INDENT}>
          {part.detail.children.map((child) => (
            <TurnView
              key={child.id}
              turn={child}
              live={live && { ...live, width: live.width - CHILD_TURN_INDENT }}
            />
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

function lastRows(text: string, count: number, width: number): string {
  const tail = lastLines(text, count);
  if (width <= 0) return tail;
  return lastLines(wrapAnsi(tail, width, { trim: false, hard: true }), count);
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
