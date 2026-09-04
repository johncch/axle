import type { Transcript, Turn, TurnEvent } from "@fifthrevision/axle/ui";
import { Box, render, Static, Text, useInput } from "ink";
import { useSyncExternalStore } from "react";
import type { BatchProgress, BatchTotals } from "../batch.js";
import { formatMs, formatTokens } from "../format.js";
import type { Renderer, SessionUsage } from "../renderer.js";
import { HostLine, useSpinner } from "./App.js";
import { UiStore } from "./store.js";

interface HostItem {
  level: "info" | "success" | "warn" | "error";
  text: string;
}

interface BatchRow {
  input: string;
  phase: string;
  startedAt: number;
}

interface BatchUiState {
  staticItems: HostItem[];
  rows: BatchRow[];
  totals?: BatchTotals;
  onInterrupt?: () => void;
  closed?: boolean;
}

function BatchApp({ store }: { store: UiStore<BatchUiState> }) {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const frame = useSpinner();

  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      state.onInterrupt?.();
    }
  });

  const now = Date.now();
  return (
    <>
      <Static items={state.staticItems}>
        {(item, index) => <HostLine key={index} level={item.level} text={item.text} />}
      </Static>
      {!state.closed &&
        state.rows.map((row) => (
          <Text key={row.input}>
            <Text color="cyan">{frame}</Text> {shortName(row.input)}{" "}
            <Text dimColor>
              · {row.phase} · {formatMs(now - row.startedAt)}
            </Text>
          </Text>
        ))}
      {!state.closed && state.totals && <TotalsLine totals={state.totals} />}
    </>
  );
}

function TotalsLine({ totals }: { totals: BatchTotals }) {
  const settled = totals.completed + totals.skipped + totals.failed;
  return (
    <Text dimColor>
      {"  "}
      {settled}/{totals.total} settled
      {totals.failed > 0 ? ` · ${totals.failed} failed` : ""} · ↑ {formatTokens(totals.tokensIn)} ↓{" "}
      {formatTokens(totals.tokensOut)}
    </Text>
  );
}

function shortName(input: string): string {
  const parts = input.split("/");
  return parts.length > 2 ? `…/${parts.slice(-2).join("/")}` : input;
}

/**
 * Test-runner-style batch UI: one spinner row per in-flight item (naturally
 * capped at the concurrency limit), a totals footer, and settled item lines
 * committed to scrollback via the shared host-line dialect.
 */
export class InkBatchRenderer implements Renderer, BatchProgress {
  private store = new UiStore<BatchUiState>({ staticItems: [], rows: [] });
  private instance: ReturnType<typeof render>;

  constructor() {
    this.instance = render(<BatchApp store={this.store} />, {
      exitOnCtrlC: false,
      patchConsole: false,
    });
  }

  batchStarted(totals: BatchTotals): void {
    this.store.update((state) => ({ ...state, totals }));
  }

  itemStarted(input: string): void {
    this.store.update((state) => ({
      ...state,
      rows: [...state.rows, { input, phase: "starting", startedAt: Date.now() }],
    }));
  }

  itemPhase(input: string, phase: string): void {
    this.store.update((state) => ({
      ...state,
      rows: state.rows.map((row) => (row.input === input ? { ...row, phase } : row)),
    }));
  }

  itemFinished(input: string, totals: BatchTotals): void {
    this.store.update((state) => ({
      ...state,
      rows: state.rows.filter((row) => row.input !== input),
      totals,
    }));
  }

  renderPriorTurns(_turns: readonly Turn[]): void {}

  onEvent(_event: TurnEvent, _transcript: Transcript): void {}

  info(message: string): void {
    this.host("info", message);
  }

  success(message: string): void {
    this.host("success", message);
  }

  warn(message: string): void {
    this.host("warn", message);
  }

  error(message: string): void {
    this.host("error", message);
  }

  promptInput(): Promise<string | null> {
    return Promise.resolve(null);
  }

  updateUsage(_usage: SessionUsage): void {}

  setInterruptHandler(handler: (() => void) | undefined): void {
    this.store.update((state) => ({ ...state, onInterrupt: handler }));
  }

  async close(): Promise<void> {
    this.store.update((state) => ({ ...state, closed: true }));
    // One beat so the final static items paint before unmount.
    await new Promise((resolve) => setTimeout(resolve, 20));
    this.instance.unmount();
  }

  private host(level: HostItem["level"], text: string): void {
    this.store.update((state) => ({
      ...state,
      staticItems: [...state.staticItems, { level, text }],
    }));
  }
}
