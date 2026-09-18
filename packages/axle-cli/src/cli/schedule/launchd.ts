import { execFile } from "node:child_process";
import { mkdir, readFile, rm } from "node:fs/promises";
import { homedir, userInfo } from "node:os";
import { dirname, join } from "node:path";
import { writeFileAtomic } from "../atomic-write.js";
import type { ScheduleBackend, ScheduleBackends } from "./backend.js";
import type { BackendBinding, DesiredSchedule } from "./records.js";

export const LAUNCHD_LABEL_PREFIX = "com.fifthrevision.axle.";

export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

export type CommandRunner = (command: string, args: string[]) => Promise<CommandResult>;

export function runCommand(command: string, args: string[]): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { encoding: "utf-8" }, (error, stdout, stderr) => {
      if (error && typeof error.code !== "number") {
        reject(error);
        return;
      }
      resolve({ code: error ? (error.code as number) : 0, stdout, stderr });
    });
  });
}

export interface LaunchdOptions {
  run: CommandRunner;
  uid: number;
  launchAgentsDir: string;
  launchctl?: string;
}

export function launchdLabel(id: string): string {
  return `${LAUNCHD_LABEL_PREFIX}${id}`;
}

export function renderPlist(label: string, desired: DesiredSchedule): string {
  const programArguments = desired.programArguments
    .map((argument) => `    <string>${escapeXml(argument)}</string>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${escapeXml(label)}</string>
  <key>ProgramArguments</key>
  <array>
${programArguments}
  </array>
  <key>WorkingDirectory</key>
  <string>${escapeXml(desired.cwd)}</string>
  <key>StartInterval</key>
  <integer>${desired.intervalSeconds}</integer>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${escapeXml(desired.path)}</string>
  </dict>
  <key>StandardOutPath</key>
  <string>${escapeXml(desired.stdoutPath)}</string>
  <key>StandardErrorPath</key>
  <string>${escapeXml(desired.stderrPath)}</string>
</dict>
</plist>
`;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

/**
 * launchd is not idempotent: bootstrapping a loaded label fails, and a
 * bootout of an unloaded one reports "No such process". Every apply boots
 * out first and tolerates that error, so create and update share one path.
 */
export function createLaunchdBackend(options: LaunchdOptions): ScheduleBackend {
  const { run, uid, launchAgentsDir } = options;
  const launchctl = options.launchctl ?? "launchctl";
  const domain = `gui/${uid}`;

  async function bootout(label: string): Promise<void> {
    const result = await run(launchctl, ["bootout", `${domain}/${label}`]);
    if (result.code === 0 || isNotLoaded(result)) return;
    throw new Error(`launchctl bootout ${label} failed (${result.code}): ${result.stderr.trim()}`);
  }

  async function bootstrap(plistPath: string): Promise<void> {
    const result = await run(launchctl, ["bootstrap", domain, plistPath]);
    if (result.code === 0) return;
    throw new Error(
      `launchctl bootstrap ${plistPath} failed (${result.code}): ${result.stderr.trim()}`,
    );
  }

  return {
    kind: "launchd",

    async apply(desired, previous) {
      const label = launchdLabel(desired.id);
      const plistPath = join(launchAgentsDir, `${label}.plist`);
      const binding: BackendBinding = { kind: "launchd", label, plistPath };

      const previousPlist =
        previous?.kind === "launchd" ? await readOptional(previous.plistPath) : undefined;

      await mkdir(dirname(desired.stdoutPath), { recursive: true });
      await mkdir(dirname(desired.stderrPath), { recursive: true });
      await mkdir(launchAgentsDir, { recursive: true });

      if (previous?.kind === "launchd") await bootout(previous.label);
      await bootout(label);

      await writeFileAtomic(plistPath, renderPlist(label, desired), { mode: 0o644 });
      try {
        await bootstrap(plistPath);
      } catch (e) {
        if (previous?.kind === "launchd" && previousPlist !== undefined) {
          if (previous.plistPath !== plistPath) await rm(plistPath, { force: true });
          await writeFileAtomic(previous.plistPath, previousPlist, { mode: 0o644 });
          await bootstrap(previous.plistPath).catch(() => {});
        } else {
          await rm(plistPath, { force: true });
        }
        throw e;
      }
      return binding;
    },

    async remove(binding) {
      if (binding.kind !== "launchd") {
        throw new Error(`launchd backend cannot remove a "${binding.kind}" binding`);
      }
      await bootout(binding.label);
      await rm(binding.plistPath, { force: true });
    },

    async isLoaded(binding) {
      if (binding.kind !== "launchd") return false;
      if ((await readOptional(binding.plistPath)) === undefined) return false;
      const result = await run(launchctl, ["print", `${domain}/${binding.label}`]);
      return result.code === 0;
    },
  };
}

function isNotLoaded(result: CommandResult): boolean {
  return result.code === 3 || /No such process|Could not find service/i.test(result.stderr);
}

async function readOptional(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf-8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw e;
  }
}

export function createScheduleBackends(options?: {
  run?: CommandRunner;
  home?: string;
  uid?: number;
  launchctl?: string;
}): ScheduleBackends {
  const home = options?.home ?? homedir();
  const launchd = createLaunchdBackend({
    run: options?.run ?? runCommand,
    uid: options?.uid ?? userInfo().uid,
    launchAgentsDir: join(home, "Library", "LaunchAgents"),
    launchctl: options?.launchctl,
  });
  return {
    forPlatform: (platform) => (platform === "darwin" ? launchd : undefined),
    forKind: (kind) => (kind === "launchd" ? launchd : undefined),
  };
}
