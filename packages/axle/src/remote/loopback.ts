import type { InMemoryEventStore } from "./eventStore.js";
import type { AgentCommand, AgentTransport, CommandOutcome } from "./protocol.js";

/**
 * The transport with no wire: the store's events straight out, each command
 * straight to `handle`, which plays the host's part of turning it into an
 * agent call.
 */
export function loopbackTransport<THostEvent extends { type: string } = never>(
  store: InMemoryEventStore<THostEvent>,
  handle: (command: AgentCommand) => Promise<CommandOutcome>,
): AgentTransport<THostEvent> {
  return {
    events: async (signal) => store.subscribe(signal),
    command: (command) => handle(command),
  };
}
