# Session Lifecycle Management

**Date:** 2026-03-02
**Status:** Future work

## Problem

When using `Agent` + `StreamSession` for long-lived server conversations, session and agent resources must eventually be freed. The challenge is distinguishing a temporary disconnect (client will reconnect) from permanent abandonment (client is gone).

Current state after the `push()`/`close()` changes:

- `createSSEStream`'s `cancel()` hook correctly cleans up the subscriber channel when a browser disconnects
- But the `Agent` keeps running (tool loops, API calls) even with zero listeners
- The `StreamSession` event buffer grows indefinitely with no cleanup signal
- `conversations` map entries are never removed

## Design

Three cleanup triggers, all driven by application code:

### 1. Explicit close

Client sends a `DELETE` to close the conversation. Server cancels in-flight work and frees resources.

```typescript
app.delete("/conversations/:id", (c) => {
  const conv = conversations.get(c.req.param("id"));
  conv.handle?.cancel();
  conv.session.close();
  conversations.delete(c.req.param("id"));
  return c.json({ status: "ok" });
});
```

Requires storing the `AgentHandle` from each `agent.send()` call:

```typescript
interface Conversation {
  agent: Agent;
  session: StreamSession;
  handle?: AgentHandle<any>;
  timeout?: ReturnType<typeof setTimeout>;
}
```

### 2. Reconnect timeout

When the last subscriber disconnects, start a grace period. If nobody reconnects within N seconds, clean up. This handles browser crashes, network failures, tabs closed without explicit cleanup.

### 3. Absolute TTL

Cap session lifetime regardless of activity. Prevents indefinite resource usage from idle-but-connected sessions.

## Required library change: subscriber count callback

The application needs to know when subscriber count transitions. The minimal addition to `StreamSession`:

```typescript
// Callback fired when subscriber count changes
onSubscriberChange?: (count: number) => void;
```

Fired in `subscribe()` on entry (increment) and in the `finally` block (decrement). The session tracks the count internally but makes no policy decisions — the application owns timeout logic.

Application usage:

```typescript
app.post("/conversations", (c) => {
  const agent = new Agent({ ... });
  const session = new StreamSession(store);
  const conv: Conversation = { agent, session };

  agent.on((event) => session.push(event));

  session.onSubscriberChange = (count) => {
    if (count === 0) {
      conv.timeout = setTimeout(() => cleanup(id, conv), 30_000);
    } else {
      clearTimeout(conv.timeout);
    }
  };

  conversations.set(session.id, conv);
  return c.json({ conversationId: session.id });
});

function cleanup(id: string, conv: Conversation) {
  conv.handle?.cancel();
  conv.session.close();
  clearTimeout(conv.timeout);
  conversations.delete(id);
}
```

## Open questions

- **Should `session.close()` be idempotent?** Currently it is (no-ops if already completed). Good.
- **Should `push()` after `close()` warn?** Currently a silent no-op. Probably fine.
- **MemorySessionStore growth** — The in-memory store never evicts sessions. For production, either implement a store with TTL-based eviction or ensure `cleanup()` also clears the store. May need a `store.delete(sessionId)` method.
- **Multiple concurrent `send()` calls** — If a second message arrives while the agent is still processing the first, we need to either queue or reject. The current `AgentHandle` only tracks the latest send. This is an application concern but worth thinking about.
- **Extracting patterns into a helper** — If the timeout/cleanup pattern is common enough, consider a `SessionManager` utility that wraps Agent + Session + lifecycle. But wait until we've built a real app to see what the right abstraction is.
