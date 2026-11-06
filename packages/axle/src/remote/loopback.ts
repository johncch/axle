import type { Agent } from "../core/agent/Agent.js";
import { agentEvents } from "./events.js";
import { processAgentCommand } from "./processAgentCommand.js";
import type { AgentTransport } from "./protocol.js";
import type { RemoteAgent } from "./RemoteAgent.js";

/** The transport with no wire: events straight off `agent.on`, commands straight in. */
export function loopbackTransport(agent: Agent | RemoteAgent): AgentTransport {
  return {
    events: async (signal) => agentEvents(agent, signal),
    command: (command) => processAgentCommand(agent, command),
  };
}
