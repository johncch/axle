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

export function createSSEResponse(session: StreamSession, afterSeq?: number): Response {
  return new Response(createSSEStream(session, afterSeq), {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
    },
  });
}

export function createSSEStream(session: StreamSession, afterSeq?: number): ReadableStream<string> {
  let generator: AsyncGenerator<SeqEvent, void, undefined>;

  return new ReadableStream<string>({
    start() {
      generator = session.subscribe(afterSeq);
    },
    async pull(controller) {
      const result = await generator.next();
      if (result.done) {
        controller.close();
        return;
      }
      controller.enqueue(serializeSSE(result.value as SeqEvent));
    },
    cancel() {
      generator.return(undefined);
    },
  });
}
