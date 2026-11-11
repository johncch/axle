# Chat input: collapsed pastes and pasted images (AXL-104)

Working note for pasting into the ink chat. Two gaps going in: a large
paste flooded the input, and an image could not be attached from the chat
at all.

## What terminals send

Cmd-V belongs to the terminal. Measured on macOS on 2026-11-10 with a probe
that turns on bracketed paste and logs the raw bytes:

| Terminal       | Image on the clipboard                        | Copied image file | Text newlines |
| -------------- | --------------------------------------------- | ----------------- | ------------- |
| Rex            | Path to a temp file it saves                  | Path              | `\n`          |
| iTerm2         | Asks: temp file path (default) or base64 text | Same dialog       | `\r`          |
| Ghostty        | Nothing                                       | Path              | `\n`          |
| macOS Terminal | Nothing                                       | Nothing (\*)      | `\r`          |
| VS Code        | Empty bracketed paste                         | Empty paste (\*)  | `\r`          |

Ctrl-V arrives as the single byte `0x16` in all five. Ghostty delivers a
paste across several reads, with the end marker in its own read.

(\*) The probe put only a file reference on the clipboard. A real copy in
Finder also carries the file name as text, so these two may paste a path
in real use. Not measured.

None of this is specified. Bracketed paste defines the markers around
pasted text and nothing about newlines or non-text content, so each
terminal chose for itself.

## What landed

- **Pastes arrive through `usePaste`**, Ink's bracketed-paste channel, as one
  string however the terminal chunks it. `\r\n` and `\r` become `\n` before
  anything is counted.
- **A paste of more than 5 lines or 500 characters is a placeholder.** So is
  an image. A placeholder is one character from a reserved private-use range
  (U+E100–U+E1FF) in the input buffer, with a side table from character to
  attachment. The cursor steps over it, Backspace removes it whole, and undo
  restores it, all with `input-buffer.ts` unchanged. Reserved characters are
  dropped from typed and pasted text so they cannot be forged.
- **Four routes attach an image**, one per terminal behaviour above: a pasted
  path to an image file; an empty paste, which reads the clipboard; Ctrl-V,
  which reads the clipboard; and pasted base64 that decodes to an image.
- **The clipboard is read with `osascript`**, macOS only: the clipboard as PNG
  data, else as a file reference to an image file.
- **A submission is `ChatInput`**: `{ text, display?, images }`.
  `Renderer.promptInput()` resolves with it, or with a bare string from a
  renderer that has no attachments. The chat loop sends images through an
  `Instruct` and passes `display` as the user message's `display` metadata.
  Ink draws a user turn from that metadata, so the transcript shows
  `[Pasted 84 lines]` while the model receives the text.
- **Image support is checked at paste time** against the catalog's input
  modalities for the session's model. An unknown model is allowed through.

## Not covered

- **Remote sessions.** The clipboard routes read the clipboard of the machine
  the CLI runs on, and a pasted path must exist there. Typing on one machine
  with `axle` on another (SSH, a Rex client attached to another host) only
  works for the base64 route. What Rex pastes from a remote client is not
  measured yet.
- **The plain renderer** has no placeholders and no image paste.
- **Several images in one paste.** A paste of more than one path is text.
