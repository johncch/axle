import type { AgentCommand } from "@fifthrevision/axle";
import {
  Agent,
  InMemoryEventStore,
  Instruct,
  parseAgentCommand,
  toEventStreamResponse,
} from "@fifthrevision/axle";
import http from "node:http";
import { useCLIHelper } from "../helpers/cli.js";
import { askUser } from "./askUser.js";

const [provider, model] = useCLIHelper();
const port = 3456;
const releaseAfterMs = 60_000;

interface Session {
  agent: Agent;
  store: InMemoryEventStore;
}

const known = new Set<string>();
const live = new Map<string, Session>();

function start(id: string): Session {
  // A real host loads the conversation from its database here.
  const agent = new Agent({ provider, model, tools: [askUser] });
  const session = { agent, store: new InMemoryEventStore(agent) };
  agent.onIdle(() => {
    setTimeout(() => {
      if (agent.status.phase !== "idle" || live.get(id) !== session) return;
      live.delete(id);
      session.store.close();
    }, releaseAfterMs);
  });
  live.set(id, session);
  return session;
}

function resume(id: string): Session | undefined {
  return live.get(id) ?? (known.has(id) ? start(id) : undefined);
}

function create(): Response {
  const id = crypto.randomUUID();
  known.add(id);
  start(id);
  return Response.json({ id }, { status: 201 });
}

function notFound(): Response {
  return Response.json({ message: "no such agent" }, { status: 404 });
}

async function subscribe(id: string, request: Request): Promise<Response> {
  const session = live.get(id);
  if (!session) return notFound();
  return toEventStreamResponse(
    session.store.subscribe(request.signal, request.headers.get("last-event-id")),
    request,
  );
}

async function handleCommand(id: string, command: AgentCommand): Promise<Response> {
  if (command.type === "send") {
    const session = resume(id);
    if (!session) return notFound();
    const { agent } = session;
    const instruct = new Instruct({ prompt: command.prompt, vars: "optional" });
    for (const file of command.files ?? []) instruct.addFile(file);
    const handle = agent.send(instruct, { id: command.id, metadata: command.metadata });
    handle.final.then(
      (result) => console.log(`[${id}] ${command.id} settled, ok: ${result.ok}`),
      (error) => console.log(`[${id}] ${command.id} rejected: ${error}`),
    );
    return Response.json({ accepted: true });
  }

  const session = live.get(id);
  if (!session) return notFound();
  const { agent } = session;
  switch (command.type) {
    case "answer":
    case "fail": {
      const call = agent.toolCall(command.callId);
      if (!call) {
        return Response.json({
          accepted: false,
          reason: { type: "not-waiting", message: `No waiting call ${command.callId}` },
        });
      }
      if (command.type === "answer") await call.answer(command.content);
      else await call.fail(command.message);
      return Response.json({ accepted: true });
    }
    case "cancel":
    case "stop": {
      const took = command.type === "cancel" ? await agent.cancel() : await agent.stop();
      return Response.json(
        took
          ? { accepted: true }
          : { accepted: false, reason: { type: "idle", message: "No active turn" } },
      );
    }
    case "clear":
      await agent.clear();
      return Response.json({ accepted: true });
  }
}

async function route(request: Request): Promise<Response> {
  const { pathname } = new URL(request.url);
  if (pathname === "/agents" && request.method === "POST") return create();
  const match = pathname.match(/^\/agents\/([\w-]+)$/);
  if (!match) return notFound();
  const id = match[1];
  if (request.method === "GET") return subscribe(id, request);
  if (request.method !== "POST") return new Response(null, { status: 405 });
  const command = parseAgentCommand(await request.json().catch(() => null));
  if (!command) return Response.json({ message: "not a command" }, { status: 400 });
  return handleCommand(id, command);
}

http
  .createServer(async (req, res) => {
    const controller = new AbortController();
    res.on("close", () => controller.abort());
    const headers = new Headers();
    for (const [name, value] of Object.entries(req.headers)) {
      if (typeof value === "string") headers.set(name, value);
    }
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk);
    const request = new Request(`http://localhost:${port}${req.url ?? "/"}`, {
      method: req.method,
      headers,
      body: req.method === "POST" ? Buffer.concat(chunks) : undefined,
      signal: controller.signal,
    });

    const response = await route(request);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    if (!response.body) return res.end();
    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
    }
    res.end();
  })
  .listen(port, () => console.log(`[Server] http://localhost:${port}/agents/:id`));
