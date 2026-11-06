import type { Agent } from "../core/agent/Agent.js";
import { Instruct } from "../core/Instruct.js";
import type { AgentCommand, CommandOutcome } from "./protocol.js";

/**
 * Apply one command to an agent. Stateless: each command is one Agent
 * method call, and the outcome says only whether the Agent took it. What
 * happens next, the queued turn, the settled call, the cancelled handle,
 * arrives on `agent.on` like everything else.
 */
export function processAgentCommand(
  agent: Pick<Agent, "send" | "toolCall" | "cancel" | "stop" | "clear">,
  command: AgentCommand,
): CommandOutcome {
  switch (command.type) {
    case "send": {
      const { schema, ...rest } = command.instruct;
      const handle = schema
        ? agent.send(Instruct.fromJSON({ ...rest, schema }), { id: command.id })
        : agent.send(Instruct.fromJSON(rest), { id: command.id });
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
      if (command.type === "answer") call.answer(command.content);
      else call.fail(command.message);
      return { accepted: true };
    }
    case "cancel":
    case "stop": {
      const took = command.type === "cancel" ? agent.cancel() : agent.stop();
      return took
        ? { accepted: true }
        : { accepted: false, reason: { type: "idle", message: "No active turn" } };
    }
    case "clear": {
      agent.clear();
      return { accepted: true };
    }
  }
}
