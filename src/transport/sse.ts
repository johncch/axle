import type { StreamSession } from "./session.js";
import type { SeqEvent } from "./store.js";

export function serializeSSE(entry: SeqEvent): string {
  const json = JSON.stringify(entry.event);
  const dataLines = json
    .split("\n")
    .map((line) => `data: ${line}`)
    .join("\n");
  return `id: ${entry.seq}\nevent: ${entry.event.type}\n${dataLines}\n\n`;
}

export function createSSEStream(session: StreamSession, afterSeq?: number): ReadableStream<string> {
  let generator: AsyncGenerator<SeqEvent, void, undefined>;

  return new ReadableStream<string>({
    start() {
      generator = session.subscribe(afterSeq);
    },
    async pull(controller) {
      const { value, done } = await generator.next();
      if (done) {
        controller.close();
        return;
      }
      controller.enqueue(serializeSSE(value));
    },
    cancel() {
      generator.return(undefined);
    },
  });
}
