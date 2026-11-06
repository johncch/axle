import type { Agent } from "../core/agent/Agent.js";
import { Instruct } from "../core/Instruct.js";
import type { AgentCommand, CommandOutcome } from "./protocol.js";
import { RemoteAgent } from "./RemoteAgent.js";

/**
 * Apply one command to an agent, local or itself remote. Stateless: each
 * command is one method call, and the outcome says only whether the agent
 * took it. What happens next, the queued turn, the settled call, the
 * cancelled handle, arrives on `agent.on` like everything else.
 */
export async function processAgentCommand<THostEvent extends { type: string }>(
  agent: Agent | RemoteAgent<THostEvent>,
  command: AgentCommand,
): Promise<CommandOutcome> {
  switch (command.type) {
    case "send": {
      const { schema, ...rest } = command.instruct;
      const options = { id: command.id };
      const handle = schema
        ? agent instanceof RemoteAgent
          ? agent.send(Instruct.fromJSON({ ...rest, schema }), options)
          : agent.send(Instruct.fromJSON({ ...rest, schema }), options)
        : agent.send(Instruct.fromJSON(rest), options);
      handle.final.catch(() => {});
      return { accepted: true };
    }
    case "answer":
    case "fail": {
      const call = agent.toolCall(command.callId);
      if (!call) {
        return {
          accepted: false,
          reason: { type: "not-waiting", message: `No waiting call ${command.callId}` },
        };
      }
      if (command.type === "answer") await call.answer(command.content);
      else await call.fail(command.message);
      return { accepted: true };
    }
    case "cancel":
    case "stop": {
      const took = command.type === "cancel" ? await agent.cancel() : await agent.stop();
      return took
        ? { accepted: true }
        : { accepted: false, reason: { type: "idle", message: "No active turn" } };
    }
    case "clear": {
      await agent.clear();
      return { accepted: true };
    }
  }
}
