import type { ActionPart, Stats, Turn, TurnPart } from "@fifthrevision/axle/ui";
import { Box, Static, Text } from "ink";
import { useEffect, useState, useSyncExternalStore } from "react";
import type { StaticItem, UiStore } from "./store.js";

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const LIVE_TAIL_LINES = 6;

export function App({ store }: { store: UiStore }) {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  return (
    <>
      <Static items={state.staticItems}>
        {(item, index) => <StaticItemView key={index} item={item} />}
      </Static>
      {state.liveTurn && <LiveRegion turn={state.liveTurn} />}
    </>
  );
}

function StaticItemView({ item }: { item: StaticItem }) {
  if (item.kind === "host") {
    const color = item.level === "error" ? "red" : item.level === "warn" ? "yellow" : undefined;
    return (
      <Text color={color} dimColor={item.level === "info"}>
        {item.text}
      </Text>
    );
  }
  return <TurnView turn={item.turn} />;
}

function LiveRegion({ turn }: { turn: Turn }) {
  const frame = useSpinner();
  return (
    <Box flexDirection="column">
      <TurnView turn={turn} live />
      <Text color="cyan">{frame}</Text>
    </Box>
  );
}

function useSpinner(): string {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 80);
    return () => clearInterval(timer);
  }, []);
  return SPINNER_FRAMES[tick % SPINNER_FRAMES.length];
}

function TurnView({ turn, live }: { turn: Turn; live?: boolean }) {
  return (
    <Box flexDirection="column" marginBottom={live ? 0 : 1}>
      {turn.parts.map((part) => (
        <PartView key={part.id} part={part} owner={turn.owner} live={live} />
      ))}
      {turn.error && <Text color="red">Error: {turn.error.message}</Text>}
      {!live && turn.owner === "agent" && turn.usage && <UsageFooter usage={turn.usage} />}
    </Box>
  );
}

function PartView({ part, owner, live }: { part: TurnPart; owner: Turn["owner"]; live?: boolean }) {
  switch (part.type) {
    case "text": {
      if (!part.text) return null;
      const text = live ? lastLines(part.text, LIVE_TAIL_LINES) : part.text.trimEnd();
      if (owner === "user") {
        return <Text dimColor>{"> " + text}</Text>;
      }
      return <Text>{text}</Text>;
    }

    case "thinking": {
      const label = part.summary?.trim()
        ? part.summary.trim()
        : `thinking${part.text ? ` (${part.text.length} chars)` : "…"}`;
      return (
        <Text dimColor italic>
          ✻ {label}
        </Text>
      );
    }

    case "action":
      return <ActionView part={part} live={live} />;

    case "citation":
      return (
        <Box flexDirection="column">
          {part.citations.map((citation, index) => {
            const source = citation.source as { title?: string; url?: string; uri?: string };
            return (
              <Text key={index} dimColor>
                ※ {source.title ?? source.url ?? source.uri ?? citation.source.type}
              </Text>
            );
          })}
        </Box>
      );

    case "file":
      return (
        <Text dimColor>
          [file] {part.file.name} ({part.file.mimeType})
        </Text>
      );

    case "compaction": {
      if (part.status === "error") {
        return <Text color="red">— compaction failed: {part.error}</Text>;
      }
      return <Text dimColor>— {part.summary ?? "context compacted"} —</Text>;
    }
  }
}

function ActionView({ part, live }: { part: ActionPart; live?: boolean }) {
  const glyph =
    part.status === "error"
      ? "✖"
      : part.status === "complete"
        ? "✔"
        : part.status === "cancelled"
          ? "⊘"
          : "⏺";
  const color = part.status === "error" ? "red" : part.status === "complete" ? "green" : "yellow";

  const args =
    part.kind === "tool" && Object.keys(part.detail.parameters).length > 0
      ? truncate(JSON.stringify(part.detail.parameters), 80)
      : undefined;

  return (
    <Box flexDirection="column">
      <Text>
        <Text color={color}>{glyph}</Text> {part.detail.name}
        {args && <Text dimColor> {args}</Text>}
      </Text>
      <ActionResultView result={part.detail.result} />
      {part.kind === "agent" && part.detail.children.length > 0 && (
        <Box flexDirection="column" paddingLeft={2}>
          {part.detail.children.map((child) => (
            <TurnView key={child.id} turn={child} live={live} />
          ))}
        </Box>
      )}
    </Box>
  );
}

function ActionResultView({
  result,
}: {
  result?: { type: string; content?: unknown; error?: { message: string } };
}) {
  if (!result) return null;
  if (result.type === "error" && result.error) {
    return <Text color="red"> {truncate(result.error.message, 200)}</Text>;
  }
  const content = typeof result.content === "string" ? result.content : undefined;
  if (!content?.trim()) return null;
  return <Text dimColor> {truncate(firstLine(content), 200)}</Text>;
}

function UsageFooter({ usage }: { usage: Stats }) {
  const parts = [`${usage.in} in / ${usage.out} out`];
  if (usage.breakdown && usage.breakdown.length > 1) {
    for (const entry of usage.breakdown) {
      parts.push(`${entry.provider}/${entry.model}: ${entry.in}/${entry.out}`);
    }
  }
  return <Text dimColor>{parts.join(" · ")}</Text>;
}

function lastLines(text: string, count: number): string {
  const lines = text.trimEnd().split("\n");
  return lines.slice(-count).join("\n");
}

function firstLine(text: string): string {
  return text.trim().split("\n", 1)[0];
}

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max - 1) + "…" : text;
}
