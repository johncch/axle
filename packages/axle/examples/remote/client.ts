import { httpTransport, isCall, RemoteAgent, Transcript } from "@fifthrevision/axle/ui";
import z from "zod";
import { askUser } from "./askUser.js";

const base = "http://localhost:3456";

const created = await fetch(`${base}/agents`, { method: "POST" });
const { id } = z.object({ id: z.string() }).parse(await created.json());

const remote = new RemoteAgent(httpTransport(`${base}/agents/${id}`));
const transcript = new Transcript();
remote.on(transcript.apply);
remote.onConnection((connection) => console.log(`[Connection] ${connection.phase}`));
remote.onToolCall((call) => {
  if (!isCall(askUser, call)) return;
  console.log(`[Asked] ${call.input.question}`);
  return "teal";
});

const result = await remote.send("Ask me my favourite colour, then tell me one fact about it.")
  .final;
console.log(`[Response] ${result.ok ? result.response : JSON.stringify(result.error)}`);
console.log(`[Turns] ${transcript.turns.length}`);
remote.close();
