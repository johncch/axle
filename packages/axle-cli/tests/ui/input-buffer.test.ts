import { describe, expect, it } from "vitest";
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
  type InputHistory,
} from "../../src/ui/ink/input-buffer.js";

function at(text: string): InputBuffer {
  const cursor = text.indexOf("|");
  return { text: text.replace("|", ""), cursor };
}

function show(buffer: InputBuffer): string {
  return `${buffer.text.slice(0, buffer.cursor)}|${buffer.text.slice(buffer.cursor)}`;
}

describe("input buffer", () => {
  describe("insertText", () => {
    it("inserts at the cursor and leaves the cursor after the insertion", () => {
      expect(show(insertText(at("summarise | report"), "the"))).toBe("summarise the| report");
    });
  });

  describe("character movement", () => {
    it("moves one character left and right", () => {
      expect(show(moveLeft(at("ab|c")))).toBe("a|bc");
      expect(show(moveRight(at("a|bc")))).toBe("ab|c");
    });

    it("stops at the ends of the text", () => {
      expect(show(moveLeft(at("|abc")))).toBe("|abc");
      expect(show(moveRight(at("abc|")))).toBe("abc|");
    });

    it("steps over an emoji as one character", () => {
      expect(show(moveLeft(at("a👍🏽|")))).toBe("a|👍🏽");
      expect(show(moveRight(at("a|👍🏽")))).toBe("a👍🏽|");
    });
  });

  describe("word movement", () => {
    it("moves left to the start of the previous word", () => {
      expect(show(moveWordLeft(at("summarise teh report|")))).toBe("summarise teh |report");
      expect(show(moveWordLeft(at("summarise teh |report")))).toBe("summarise |teh report");
    });

    it("moves right to the end of the next word", () => {
      expect(show(moveWordRight(at("summarise| teh report")))).toBe("summarise teh| report");
    });

    it("skips punctuation between words", () => {
      expect(show(moveWordLeft(at("src/ui/|")))).toBe("src/|ui/");
      expect(show(moveWordRight(at("src|/ui/")))).toBe("src/ui|/");
    });
  });

  describe("line movement", () => {
    it("moves to the start and end of the current line only", () => {
      expect(show(moveToLineStart(at("first\nsec|ond\nthird")))).toBe("first\n|second\nthird");
      expect(show(moveToLineEnd(at("first\nsec|ond\nthird")))).toBe("first\nsecond|\nthird");
    });

    it("moves up and down keeping the column", () => {
      expect(show(moveUp(at("first\nsec|ond")))).toBe("fir|st\nsecond");
      expect(show(moveDown(at("fir|st\nsecond")))).toBe("first\nsec|ond");
    });

    it("clamps to the end of a shorter line", () => {
      expect(show(moveUp(at("ab\nlonger|")))).toBe("ab|\nlonger");
      expect(show(moveDown(at("longer|\nab")))).toBe("longer\nab|");
    });

    it("stays put on the first and last line", () => {
      expect(show(moveUp(at("fir|st\nsecond")))).toBe("fir|st\nsecond");
      expect(show(moveDown(at("first\nsec|ond")))).toBe("first\nsec|ond");
    });
  });

  describe("deletes", () => {
    it("deletes the character before and after the cursor", () => {
      expect(show(deleteBackward(at("ab|c")))).toBe("a|c");
      expect(show(deleteForward(at("a|bc")))).toBe("a|c");
    });

    it("deletes a whole emoji", () => {
      expect(show(deleteBackward(at("a👍🏽|")))).toBe("a|");
    });

    it("deletes the word before the cursor", () => {
      expect(show(deleteWordBackward(at("run the tests agian|")))).toBe("run the tests |");
      expect(show(deleteWordBackward(at("run the tests |")))).toBe("run the |");
    });

    it("deletes back to the start of the current line only", () => {
      expect(show(deleteToLineStart(at("first\nsec|ond")))).toBe("first\n|ond");
    });
  });
});

function type(history: InputHistory, text: string): InputHistory {
  return [...text].reduce(
    (current, character) => applyEdit(current, (b) => insertText(b, character), "typing"),
    history,
  );
}

describe("input history", () => {
  it("undoes a run of typed characters as one step", () => {
    const typed = type(EMPTY_INPUT_HISTORY, "fix teh report");
    expect(show(undo(typed).current)).toBe("|");
  });

  it("undoes a word delete separately from the typing before it", () => {
    const typed = type(EMPTY_INPUT_HISTORY, "fix teh report");
    const deleted = applyEdit(typed, deleteWordBackward, "other");
    expect(show(undo(deleted).current)).toBe("fix teh report|");
    expect(show(undo(undo(deleted)).current)).toBe("|");
  });

  it("starts a new step for typing after the cursor moved", () => {
    const typed = type(EMPTY_INPUT_HISTORY, "ac");
    const moved = applyEdit(typed, moveLeft, "other");
    const inserted = type(moved, "b");
    expect(show(inserted.current)).toBe("ab|c");
    expect(show(undo(inserted).current)).toBe("a|c");
  });

  it("does not record cursor movement as a step", () => {
    const typed = type(EMPTY_INPUT_HISTORY, "abc");
    const moved = applyEdit(applyEdit(typed, moveLeft, "other"), moveLeft, "other");
    expect(show(undo(moved).current)).toBe("|");
  });

  it("redoes what was undone", () => {
    const typed = type(EMPTY_INPUT_HISTORY, "hello");
    expect(show(redo(undo(typed)).current)).toBe("hello|");
  });

  it("drops the redo steps once a new edit is made", () => {
    const undone = undo(type(EMPTY_INPUT_HISTORY, "hello"));
    const retyped = type(undone, "bye");
    expect(show(redo(retyped).current)).toBe("bye|");
  });

  it("leaves the buffer alone when there is nothing to undo or redo", () => {
    expect(undo(EMPTY_INPUT_HISTORY)).toBe(EMPTY_INPUT_HISTORY);
    expect(redo(EMPTY_INPUT_HISTORY)).toBe(EMPTY_INPUT_HISTORY);
  });
});
