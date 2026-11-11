export type Rgb = readonly [red: number, green: number, blue: number];

const QUERY_BACKGROUND = "\u001b]11;?\u001b\\";
const QUERY_DEVICE_ATTRIBUTES = "\u001b[c";
const BACKGROUND_REPLY = /\u001b\]11;rgba?:([0-9a-f]{1,4})\/([0-9a-f]{1,4})\/([0-9a-f]{1,4})/i;
const DEVICE_ATTRIBUTES_REPLY = /\u001b\[\?[0-9;]*c/;
const QUERY_TIMEOUT_MS = 200;
const MIN_COLOR_DEPTH = 8;

const LIGHT_SHADE = { top: 0, alpha: 0.04 };
const DARK_SHADE = { top: 255, alpha: 0.08 };

/** Parse a terminal's reply to the background colour query (OSC 11). */
export function parseBackgroundReply(reply: string): Rgb | undefined {
  const match = BACKGROUND_REPLY.exec(reply);
  if (!match) return undefined;
  const channel = (hex: string) => Math.round((parseInt(hex, 16) / (16 ** hex.length - 1)) * 255);
  return [channel(match[1]), channel(match[2]), channel(match[3])];
}

/** The fill behind a user message: the terminal's background, shaded slightly toward contrast. */
export function userMessageBackground(background: Rgb): string {
  const [red, green, blue] = background;
  const light = 0.299 * red + 0.587 * green + 0.114 * blue > 128;
  const { top, alpha } = light ? LIGHT_SHADE : DARK_SHADE;
  return (
    "#" +
    background
      .map((channel) => Math.round(top * alpha + channel * (1 - alpha)))
      .map((channel) => channel.toString(16).padStart(2, "0"))
      .join("")
  );
}

/**
 * Ask the terminal for its background colour. Undefined when it does not
 * answer or cannot show the shade. Reads stdin in raw mode, so call it before
 * anything else owns stdin.
 */
export async function queryUserMessageBackground(
  stdin: NodeJS.ReadStream = process.stdin,
  stdout: NodeJS.WriteStream = process.stdout,
): Promise<string | undefined> {
  if (!stdin.isTTY || !stdout.isTTY || stdout.getColorDepth() < MIN_COLOR_DEPTH) return undefined;

  const wasRaw = stdin.isRaw;
  const reply = await new Promise<string>((resolve) => {
    let received = "";
    const finish = () => {
      clearTimeout(timer);
      stdin.off("readable", onReadable);
      resolve(received);
    };
    const onReadable = () => {
      let chunk: Buffer | string | null;
      while ((chunk = stdin.read()) !== null) {
        received += typeof chunk === "string" ? chunk : chunk.toString("latin1");
      }
      if (DEVICE_ATTRIBUTES_REPLY.test(received)) finish();
    };
    const timer = setTimeout(finish, QUERY_TIMEOUT_MS);
    stdin.setRawMode(true);
    stdin.on("readable", onReadable);
    stdout.write(QUERY_BACKGROUND + QUERY_DEVICE_ATTRIBUTES);
  });
  stdin.setRawMode(wasRaw);

  const background = parseBackgroundReply(reply);
  return background ? userMessageBackground(background) : undefined;
}
