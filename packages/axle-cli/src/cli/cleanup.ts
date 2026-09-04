import * as clack from "@clack/prompts";
import { rm } from "node:fs/promises";
import type { SessionSummary } from "./sessions.js";
import { listSessionSummaries } from "./sessions.js";

const WINDOWS = [
  { label: "Older than 24 hours", ms: 24 * 60 * 60 * 1000 },
  { label: "Older than 7 days", ms: 7 * 24 * 60 * 60 * 1000 },
  { label: "Older than 30 days", ms: 30 * 24 * 60 * 60 * 1000 },
  { label: "Everything", ms: 0 },
];

/**
 * `axle cleanup`: time-window session deletion. Sessions accumulate by
 * design (no retention policy); this is the manual relief valve. Corrupt
 * session files have no timestamp and count as infinitely old — any window
 * sweeps them.
 */
export async function runCleanup(home?: string): Promise<void> {
  clack.intro("axle cleanup");

  const sessions = await listSessionSummaries(home);
  if (sessions.length === 0) {
    clack.outro("No saved sessions.");
    return;
  }

  const now = Date.now();
  const inWindow = (session: SessionSummary, windowMs: number): boolean => {
    if (windowMs === 0 || session.corrupt) return true;
    const updated = Date.parse(session.updatedAt);
    return !Number.isFinite(updated) || now - updated > windowMs;
  };

  const options = WINDOWS.map((window) => {
    const matched = sessions.filter((session) => inWindow(session, window.ms));
    const bytes = matched.reduce((sum, s) => sum + s.sizeBytes, 0);
    return {
      window,
      matched,
      label: `${window.label} (${matched.length} session${matched.length === 1 ? "" : "s"} · ${formatBytes(bytes)})`,
    };
  }).filter((option) => option.matched.length > 0);

  if (options.length === 0) {
    clack.outro(`Nothing old enough to clean up (${sessions.length} recent sessions).`);
    return;
  }

  const CANCEL = "__cancel__";
  const picked = await clack.select({
    message: "What should be cleaned up?",
    options: [
      ...options.map((option, index) => ({ value: String(index), label: option.label })),
      { value: CANCEL, label: "Nothing, cancel" },
    ],
  });
  if (clack.isCancel(picked) || picked === CANCEL) {
    clack.outro("Nothing deleted.");
    return;
  }

  const chosen = options[Number(picked)];
  const sure = await clack.confirm({
    message: `Delete ${chosen.matched.length} session(s)? This cannot be undone.`,
    initialValue: false,
  });
  if (clack.isCancel(sure) || !sure) {
    clack.outro("Nothing deleted.");
    return;
  }

  for (const session of chosen.matched) {
    await rm(session.path, { force: true });
  }
  clack.outro(`Deleted ${chosen.matched.length} session(s).`);
}

function formatBytes(bytes: number): string {
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  if (bytes >= 1_024) return `${(bytes / 1_024).toFixed(1)} kB`;
  return `${bytes} B`;
}
