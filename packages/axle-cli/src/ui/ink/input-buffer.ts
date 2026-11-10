export interface InputBuffer {
  text: string;
  cursor: number;
}

export const EMPTY_INPUT_BUFFER: InputBuffer = { text: "", cursor: 0 };

export interface InputHistory {
  current: InputBuffer;
  undoStack: readonly InputBuffer[];
  redoStack: readonly InputBuffer[];
  lastChange: "typing" | "other";
}

export const EMPTY_INPUT_HISTORY: InputHistory = {
  current: EMPTY_INPUT_BUFFER,
  undoStack: [],
  redoStack: [],
  lastChange: "other",
};

export function applyEdit(
  history: InputHistory,
  edit: (buffer: InputBuffer) => InputBuffer,
  change: "typing" | "other",
): InputHistory {
  const next = edit(history.current);
  if (next.text === history.current.text) {
    return { ...history, current: next, lastChange: "other" };
  }
  const extendsTypingRun = change === "typing" && history.lastChange === "typing";
  return {
    current: next,
    undoStack: extendsTypingRun ? history.undoStack : [...history.undoStack, history.current],
    redoStack: [],
    lastChange: change,
  };
}

export function undo(history: InputHistory): InputHistory {
  const previous = history.undoStack.at(-1);
  if (!previous) return history;
  return {
    current: previous,
    undoStack: history.undoStack.slice(0, -1),
    redoStack: [...history.redoStack, history.current],
    lastChange: "other",
  };
}

export function redo(history: InputHistory): InputHistory {
  const next = history.redoStack.at(-1);
  if (!next) return history;
  return {
    current: next,
    undoStack: [...history.undoStack, history.current],
    redoStack: history.redoStack.slice(0, -1),
    lastChange: "other",
  };
}

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const WORD_CHARACTER = /[\p{L}\p{N}_]/u;

export function insertText(buffer: InputBuffer, inserted: string): InputBuffer {
  return {
    text: buffer.text.slice(0, buffer.cursor) + inserted + buffer.text.slice(buffer.cursor),
    cursor: buffer.cursor + inserted.length,
  };
}

export function moveLeft(buffer: InputBuffer): InputBuffer {
  return { ...buffer, cursor: previousGraphemeStart(buffer) };
}

export function moveRight(buffer: InputBuffer): InputBuffer {
  return { ...buffer, cursor: nextGraphemeEnd(buffer) };
}

export function moveWordLeft(buffer: InputBuffer): InputBuffer {
  return { ...buffer, cursor: previousWordStart(buffer) };
}

export function moveWordRight(buffer: InputBuffer): InputBuffer {
  const { text } = buffer;
  let index = buffer.cursor;
  while (index < text.length && !WORD_CHARACTER.test(text[index])) index++;
  while (index < text.length && WORD_CHARACTER.test(text[index])) index++;
  return { ...buffer, cursor: index };
}

export function moveToLineStart(buffer: InputBuffer): InputBuffer {
  return { ...buffer, cursor: lineStart(buffer.text, buffer.cursor) };
}

export function moveToLineEnd(buffer: InputBuffer): InputBuffer {
  return { ...buffer, cursor: lineEnd(buffer.text, buffer.cursor) };
}

export function moveUp(buffer: InputBuffer): InputBuffer {
  const currentStart = lineStart(buffer.text, buffer.cursor);
  if (currentStart === 0) return buffer;
  const column = buffer.cursor - currentStart;
  const previousEnd = currentStart - 1;
  const previousStart = lineStart(buffer.text, previousEnd);
  return { ...buffer, cursor: Math.min(previousStart + column, previousEnd) };
}

export function moveDown(buffer: InputBuffer): InputBuffer {
  const currentEnd = lineEnd(buffer.text, buffer.cursor);
  if (currentEnd === buffer.text.length) return buffer;
  const column = buffer.cursor - lineStart(buffer.text, buffer.cursor);
  const nextStart = currentEnd + 1;
  return { ...buffer, cursor: Math.min(nextStart + column, lineEnd(buffer.text, nextStart)) };
}

export function deleteBackward(buffer: InputBuffer): InputBuffer {
  return deleteBackTo(buffer, previousGraphemeStart(buffer));
}

export function deleteForward(buffer: InputBuffer): InputBuffer {
  return {
    text: buffer.text.slice(0, buffer.cursor) + buffer.text.slice(nextGraphemeEnd(buffer)),
    cursor: buffer.cursor,
  };
}

export function deleteWordBackward(buffer: InputBuffer): InputBuffer {
  return deleteBackTo(buffer, previousWordStart(buffer));
}

export function deleteToLineStart(buffer: InputBuffer): InputBuffer {
  return deleteBackTo(buffer, lineStart(buffer.text, buffer.cursor));
}

function deleteBackTo(buffer: InputBuffer, start: number): InputBuffer {
  return {
    text: buffer.text.slice(0, start) + buffer.text.slice(buffer.cursor),
    cursor: start,
  };
}

function lineStart(text: string, index: number): number {
  return text.lastIndexOf("\n", index - 1) + 1;
}

function lineEnd(text: string, index: number): number {
  const newline = text.indexOf("\n", index);
  return newline === -1 ? text.length : newline;
}

function previousWordStart(buffer: InputBuffer): number {
  const { text } = buffer;
  let index = buffer.cursor;
  while (index > 0 && !WORD_CHARACTER.test(text[index - 1])) index--;
  while (index > 0 && WORD_CHARACTER.test(text[index - 1])) index--;
  return index;
}

function previousGraphemeStart(buffer: InputBuffer): number {
  let start = 0;
  for (const segment of graphemes.segment(buffer.text.slice(0, buffer.cursor))) {
    start = segment.index;
  }
  return start;
}

function nextGraphemeEnd(buffer: InputBuffer): number {
  const [first] = graphemes.segment(buffer.text.slice(buffer.cursor));
  return first ? buffer.cursor + first.segment.length : buffer.cursor;
}
