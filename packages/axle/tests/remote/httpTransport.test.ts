import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, test } from "vitest";
import { Agent } from "../../src/core/agent/index.js";
import { EventLog } from "../../src/remote/eventLog.js";
import { HttpTransportError, httpTransport } from "../../src/remote/httpTransport.js";
import { processAgentCommand } from "../../src/remote/processAgentCommand.js";
import type { AgentCommand } from "../../src/remote/protocol.js";
import { RemoteAgent } from "../../src/remote/RemoteAgent.js";
import { toEventStreamResponse } from "../../src/remote/sse.js";
import { Transcript } from "../../src/turns/transcript.js";
import { askUser, askUserProvider, textProvider, waitFor } from "./helpers.js";

/** Closes the stream after `count` messages, as a dropped connection would. */
function cutAfter(count: number): TransformStream<Uint8Array, Uint8Array> {
  let seen = 0;
  return new TransformStream({
    transform(chunk, controller) {
      controller.enqueue(chunk);
      seen += 1;
      if (seen === count) controller.terminate();
    },
  });
}

async function handle(agent: Agent, log: EventLog, request: Request): Promise<Response> {
  if (request.method === "POST") {
    const command: AgentCommand = await request.json();
    return Response.json(await processAgentCommand(agent, command));
  }
  const after = request.headers.get("last-event-id");
  return toEventStreamResponse(log.subscribe(request.signal, after), request);
}

function fakeHost(agent: Agent, log: EventLog) {
  const streamRequests: Array<string | null> = [];
  let dropNextAfter: number | undefined;
  let goneAfterFirst = false;
  const failNext: number[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    if (request.method !== "GET") return handle(agent, log, request);
    streamRequests.push(request.headers.get("last-event-id"));
    if (goneAfterFirst && streamRequests.length > 1) return new Response(null, { status: 410 });
    const status = failNext.shift();
    if (status !== undefined) return new Response(null, { status });
    const response = await handle(agent, log, request);
    if (dropNextAfter === undefined) return response;
    const cut = dropNextAfter;
    dropNextAfter = undefined;
    return new Response(response.body!.pipeThrough(cutAfter(cut)), response);
  };
  return {
    fetch: fetchImpl,
    streamRequests,
    dropNextAfter: (count: number) => {
      dropNextAfter = count;
    },
    goneAfterFirst: () => {
      goneAfterFirst = true;
    },
    failNext: (...statuses: number[]) => {
      failNext.push(...statuses);
    },
  };
}

function seqs(entries: { cursor: string }[]): number[] {
  return entries.map((entry) => Number(entry.cursor.split("-")[1]));
}

describe("httpTransport", () => {
  test("a dropped stream reconnects with Last-Event-ID and the replay fills the gap once", async () => {
    const agent = new Agent({ provider: askUserProvider(), model: "mock", tools: [askUser] });
    const log = new EventLog(agent);
    const host = fakeHost(agent, log);
    host.dropNextAfter(3);
    const remote = new RemoteAgent(
      httpTransport("http://agent/42", { fetch: host.fetch, reconnectDelayMs: 0 }),
    );
    const seen: { cursor: string }[] = [];
    const transcript = new Transcript();
    remote.on((event) => {
      seen.push(event);
      transcript.apply(event);
    });
    remote.onToolCall(() => "teal");

    const result = await remote.send("ask", { id: "op-1" }).final;
    remote.close();

    expect(result.response).toBe("saw ask-user=teal");
    expect(host.streamRequests).toEqual([null, `${log.id}-3`]);
    expect(seqs(seen)).toEqual(seen.map((_, i) => i + 1));
    expect(transcript.turns.map((turn) => turn.id)[0]).toBe("op-1");
    expect(transcript.turns.at(-1)?.status).toBe("complete");
  });

  test("after resumes the first connection from a stored cursor", async () => {
    const agent = new Agent({ provider: textProvider(["one", "two"]), model: "mock" });
    const log = new EventLog(agent);
    const host = fakeHost(agent, log);
    await agent.send("first").final;
    const after = log.lastCursor;

    const remote = new RemoteAgent(httpTransport("http://agent/42", { fetch: host.fetch, after }));
    const seen: { cursor: string }[] = [];
    remote.on((event) => {
      seen.push(event);
    });
    await remote.send("second").final;
    remote.close();

    expect(host.streamRequests).toEqual([after]);
    expect(seqs(seen)[0]).toBe(Number(after.split("-")[1]) + 1);
  });

  test("a reconnect answered 410 ends the agent", async () => {
    const agent = new Agent({ provider: textProvider(["hi"]), model: "mock" });
    const log = new EventLog(agent);
    const host = fakeHost(agent, log);
    host.dropNextAfter(2);
    host.goneAfterFirst();
    const remote = new RemoteAgent(
      httpTransport("http://agent/42", { fetch: host.fetch, reconnectDelayMs: 0 }),
    );
    await waitFor(() => remote.state.phase === "idle");

    agent.send("hello");
    await waitFor(() => remote.state.phase === "ended");

    expect(host.streamRequests).toEqual([null, `${log.id}-2`]);
  });

  test("a 5xx on reconnect is retried with a doubling wait, so a deploy in progress does not end the client", async () => {
    const agent = new Agent({ provider: askUserProvider(), model: "mock", tools: [askUser] });
    const log = new EventLog(agent);
    const host = fakeHost(agent, log);
    host.dropNextAfter(3);
    const attempts: number[] = [];
    const remote = new RemoteAgent(
      httpTransport("http://agent/42", {
        reconnectDelayMs: 10,
        maxReconnectDelayMs: 15,
        fetch: (input, init) => {
          attempts.push(Date.now());
          return host.fetch(input, init);
        },
      }),
    );
    remote.onToolCall(() => "teal");
    await waitFor(() => remote.state.phase === "idle");
    host.failNext(503, 503);

    const result = await remote.send("ask").final;
    remote.close();

    expect(result.response).toBe("saw ask-user=teal");
    expect(host.streamRequests).toEqual([null, `${log.id}-3`, `${log.id}-3`, `${log.id}-3`]);
    const gets = attempts.slice(0, 4);
    expect(gets[2] - gets[1]).toBeGreaterThanOrEqual(10);
    expect(gets[3] - gets[2]).toBeGreaterThanOrEqual(15);
  });

  test("a failed first connection is an error, and a failed command rejects", async () => {
    const transport = httpTransport("http://agent/42", {
      fetch: async () => new Response("nope", { status: 503 }),
    });
    const remote = new RemoteAgent(transport);
    await waitFor(() => remote.state.phase === "error");

    expect(remote.state).toEqual({ phase: "error", message: "Event stream request failed: 503" });
    await expect(transport.command({ type: "cancel" })).rejects.toBeInstanceOf(HttpTransportError);
  });

  test("headers are sent with the stream and each command", async () => {
    const agent = new Agent({ provider: textProvider(["hi"]), model: "mock" });
    const log = new EventLog(agent);
    const host = fakeHost(agent, log);
    const authorizations: Array<string | null> = [];
    let token = 0;
    const transport = httpTransport("http://agent/42", {
      headers: () => ({ authorization: `Bearer t${++token}` }),
      fetch: (input, init) => {
        authorizations.push(new Request(input, init).headers.get("authorization"));
        return host.fetch(input, init);
      },
    });
    const remote = new RemoteAgent(transport);
    await remote.send("hello").final;
    remote.close();

    expect(authorizations).toEqual(["Bearer t1", "Bearer t2"]);
  });
});

describe("httpTransport over node:http", () => {
  function requestFrom(req: IncomingMessage, origin: string, body: string): Request {
    const headers = new Headers();
    for (const [name, value] of Object.entries(req.headers)) {
      if (typeof value === "string") headers.set(name, value);
    }
    const controller = new AbortController();
    req.on("close", () => controller.abort());
    return new Request(`${origin}${req.url}`, {
      method: req.method,
      headers,
      body: req.method === "POST" ? body : undefined,
      signal: controller.signal,
    });
  }

  async function write(response: Response, res: ServerResponse): Promise<void> {
    res.writeHead(response.status, Object.fromEntries(response.headers));
    if (response.body === null) {
      res.end();
      return;
    }
    const reader = response.body.getReader();
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      res.write(value);
    }
    res.end();
  }

  test("sends over a real server, answers the waiting call, and resumes after the server drops it", async () => {
    const agent = new Agent({ provider: askUserProvider(), model: "mock", tools: [askUser] });
    const log = new EventLog(agent);
    let dropAt: number | undefined = 3;
    const server = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk);
      const request = requestFrom(req, "http://localhost", Buffer.concat(chunks).toString());
      const response = await handle(agent, log, request);
      if (req.method === "GET" && dropAt !== undefined) {
        const cut = dropAt;
        dropAt = undefined;
        return write(new Response(response.body!.pipeThrough(cutAfter(cut)), response), res);
      }
      return write(response, res);
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;

    const remote = new RemoteAgent(
      httpTransport(`http://localhost:${port}/agents/42`, { reconnectDelayMs: 0 }),
    );
    const seen: { cursor: string }[] = [];
    remote.on((event) => {
      seen.push(event);
    });
    remote.onToolCall(() => "teal");
    const result = await remote.send("ask").final;
    remote.close();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );

    expect(result.response).toBe("saw ask-user=teal");
    expect(seqs(seen)).toEqual(seen.map((_, i) => i + 1));
  });
});
