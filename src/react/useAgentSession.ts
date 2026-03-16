import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Turn } from "../turns/types.js";
import { handleSSEEvent, parseSSEEvents } from "./events.js";
import type {
  AgentStatus,
  UseAgentSessionOptions,
  UseAgentSessionReturn,
} from "./types.js";

export function useAgentSession(
  url: string,
  options?: UseAgentSessionOptions,
): UseAgentSessionReturn {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [status, setStatus] = useState<AgentStatus>("idle");

  const sessionId = useMemo(() => options?.sessionId ?? crypto.randomUUID(), [options?.sessionId]);

  const configRef = useRef(options?.config);
  const configSentRef = useRef(false);
  const subscriptionRef = useRef<AbortController | null>(null);
  const lastSeqRef = useRef(0);
  const hadErrorRef = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    subscriptionRef.current = controller;

    const ctx = { setTurns, setStatus, hadErrorRef };

    (async () => {
      try {
        const params = new URLSearchParams({ sessionId });
        if (lastSeqRef.current > 0) {
          params.set("lastSeq", String(lastSeqRef.current));
        }

        const res = await fetch(`${url}?${params}`, {
          signal: controller.signal,
        });

        if (!res.ok || !res.body) {
          setStatus("error");
          return;
        }

        setStatus("ready");

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          const { events, remaining } = parseSSEEvents(chunk, buffer);
          buffer = remaining;
          for (const event of events) {
            if (event.id) {
              lastSeqRef.current = parseInt(event.id, 10);
            }
            handleSSEEvent(event, ctx);
          }
        }

        if (buffer.trim()) {
          const { events } = parseSSEEvents("\n\n", buffer);
          for (const event of events) {
            if (event.id) {
              lastSeqRef.current = parseInt(event.id, 10);
            }
            handleSSEEvent(event, ctx);
          }
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          return;
        }
        setStatus("error");
      }
    })();

    return () => {
      controller.abort();
      subscriptionRef.current = null;
    };
  }, [url, sessionId]);

  const send = useCallback(
    (message: string) => {
      const payload: Record<string, unknown> = { message, sessionId };
      if (!configSentRef.current && configRef.current) {
        payload.config = configRef.current;
        configSentRef.current = true;
      }
      fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }).catch(() => {
        setStatus("error");
      });
    },
    [url, sessionId],
  );

  const cancel = useCallback(() => {
    fetch(url, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId }),
    }).catch(() => {});
  }, [url, sessionId]);

  return { turns, status, sessionId, send, cancel };
}
