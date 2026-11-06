import type { Agent } from "../core/agent/Agent.js";
import { agentEvents } from "./events.js";
import { processAgentCommand } from "./processAgentCommand.js";
import type { AgentTransport } from "./protocol.js";

/** The transport with no wire: events straight off `agent.on`, commands straight in. */
export function loopbackTransport(
  agent: Pick<Agent, "on" | "send" | "toolCall" | "cancel" | "stop" | "clear">,
): AgentTransport {
  return {
    events: (signal) => agentEvents(agent, signal),
    command: async (command) => processAgentCommand(agent, command),
  };
}
