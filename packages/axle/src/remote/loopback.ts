import type { Agent } from "../core/agent/Agent.js";
import type { EventLog } from "./eventLog.js";
import { processAgentCommand } from "./processAgentCommand.js";
import type { AgentTransport } from "./protocol.js";
import type { RemoteAgent } from "./RemoteAgent.js";

/** The transport with no wire: the log's entries straight out, commands straight in. */
export function loopbackTransport<THostEvent extends { type: string } = never>(
  agent: Agent | RemoteAgent<THostEvent>,
  log: EventLog<THostEvent>,
): AgentTransport<THostEvent> {
  return {
    events: async (signal) => log.subscribe(signal),
    command: (command) => processAgentCommand(agent, command),
  };
}
