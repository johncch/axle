# Chat transcript: user messages and progressive commit (AXL-105)

Working note for three display changes in the ink chat transcript.

## User messages

A user message in scrollback has one blank line above and below it and sits
on a full-width band.

The band's colour comes from the terminal. `queryUserMessageBackground`
(`src/ui/terminal-background.ts`) asks for the background colour with OSC 11
before ink takes stdin, then shades it: 8% toward white on a dark
background, 4% toward black on a light one. The approach is the Codex TUI's,
which uses 12% on dark; that read too strong here. A device attributes query follows the OSC 11 query, so a terminal
that ignores OSC 11 still ends the wait at once; one that answers neither
costs a 200 ms timeout. Rex answered in 2 ms.

The `❯` on a committed message is dim. No answer, or fewer than 256
colours, means no band; the message is otherwise drawn the same.

Tried and dropped on the way: a cyan `❯` (the issue's proposal), a dim `❯`,
a band in the terminal's bright black, and a band in a fixed `#373737`.

## The streaming jump

Reproduced with a render test at 80 columns and four 70-word paragraphs,
measuring the height of the live region as the text grew. It climbed to 26
rows, then fell to 20 in one frame.

The cause was the one the issue suspected. The live region showed the last
6 lines of the rendered text counted by newline, and a paragraph is one
line however far it wraps. So the region grew a row with each wrap and lost
a whole paragraph's rows when a new one pushed it out.

## What was tried

1. **A tail of 6 terminal rows**, counted after wrapping to the terminal
   width. The height was steady, but 6 rows is a keyhole: a blank row
   between paragraphs counts, so it often showed 5 lines of text. Dropped.
2. **Progressive commit.** This is what landed.

Showing the whole reply in the live region was not an option. Ink redraws
that region every frame and can only erase rows still on screen, so it
cannot be taller than the terminal.

## What landed

- **A streaming turn commits to scrollback as it goes.** `partitionTurns`
  in `src/ui/ink/store.ts` keeps, per streaming turn, how many parts are in
  scrollback and how many characters of the next text part. Each call
  returns the new slice to commit and the remainder to draw live.
- **A part commits once it has settled**: a later part has started, and it
  is not an action or compaction still pending or running.
- **The text part being written commits by markdown block.** The
  uncommitted text is lexed with `marked`, and every block before the last
  one commits. The last block stays live because later text can still
  change it: a list gains items, a table gains rows, a code fence is still
  open.
- **A slice is a turn.** Each commit is a scrollback item holding a copy of
  the turn with only the new parts, so drawing did not change. An item that
  resumes a text part carries `continues`, which draws the blank line that
  separated the two blocks.
- **The live block is still capped**, at half the terminal's rows, between
  6 and 20, counted after wrapping (`wrap-ansi`, the wrapper Ink uses). A
  long code block shows its last rows while open and commits whole.

## Checked

Streamed a reply with a heading, paragraphs, a list, a 30-line code block
and a table through the real `InkRenderer` in a Rex terminal. The final
scrollback held every line exactly once.

## Not covered

- **A link reference defined later** (`[name]: url`) does not restyle a
  block already in scrollback.
- **Tool lines and subagent turns** in the live region are not capped. A
  turn with many running actions can still be tall.
- **The plain renderer** is unchanged.
