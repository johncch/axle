import type { Agent } from "../core/agent/Agent.js";
import type { InMemoryEventStore } from "./eventStore.js";
import { processAgentCommand } from "./processAgentCommand.js";
import type { AgentTransport } from "./protocol.js";
import type { RemoteAgent } from "./RemoteAgent.js";

/** The transport with no wire: the store's events straight out, commands straight in. */
export function loopbackTransport<THostEvent extends { type: string } = never>(
  agent: Agent | RemoteAgent<THostEvent>,
  store: InMemoryEventStore<THostEvent>,
): AgentTransport<THostEvent> {
  return {
    events: async (signal) => store.subscribe(signal),
    command: (command) => processAgentCommand(agent, command),
  };
}
