import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CommandResult } from "../../../src/cli/schedule/launchd.js";
import {
  createLaunchdBackend,
  createScheduleBackends,
  renderPlist,
} from "../../../src/cli/schedule/launchd.js";
import type { DesiredSchedule } from "../../../src/cli/schedule/records.js";

const TEST_DIR = join(import.meta.dirname, "__launchd_tmp__");
const HOME = join(TEST_DIR, "home");
const LAUNCH_AGENTS = join(HOME, "Library", "LaunchAgents");
const OK: CommandResult = { code: 0, stdout: "", stderr: "" };
const NOT_LOADED: CommandResult = {
  code: 3,
  stdout: "",
  stderr: "Boot-out failed: 3: No such process",
};

class FakeLaunchctl {
  calls: string[][] = [];
  replies: Array<(args: string[]) => CommandResult> = [];

  run = async (command: string, args: string[]): Promise<CommandResult> => {
    expect(command).toBe("launchctl");
    this.calls.push(args);
    const reply = this.replies.shift();
    return reply ? reply(args) : OK;
  };
}

function desired(overrides: Partial<DesiredSchedule> = {}): DesiredSchedule {
  return {
    id: "abc123",
    name: "monitor",
    recipePath: join(HOME, "My Recipes", "monitor.yml"),
    cwd: join(HOME, "My Recipes"),
    intervalSeconds: 3600,
    programArguments: [
      "/usr/local/bin/node",
      "/usr/local/lib/axle/dist/cli.js",
      "-j",
      join(HOME, "My Recipes", "monitor.yml"),
      "--renderer",
      "plain",
      "--no-log",
      "--scheduled",
      "abc123",
    ],
    path: "/usr/local/bin:/usr/bin:/bin",
    stdoutPath: join(HOME, ".axle", "logs", "schedules", "abc123.out.log"),
    stderrPath: join(HOME, ".axle", "logs", "schedules", "abc123.err.log"),
    ...overrides,
  };
}

function backendWith(launchctl: FakeLaunchctl) {
  return createLaunchdBackend({ run: launchctl.run, uid: 501, launchAgentsDir: LAUNCH_AGENTS });
}

beforeEach(async () => {
  await mkdir(HOME, { recursive: true });
});

afterEach(async () => {
  await rm(TEST_DIR, { recursive: true, force: true });
});

type PlistValue = string | number | PlistValue[] | { [key: string]: PlistValue };

function parsePlist(xml: string): PlistValue {
  const tokens = xml.match(/<\/?[a-z]+>|<[a-z]+\/>|[^<]+/g)!.filter((token) => token.trim());
  let index = tokens.indexOf("<dict>");
  const unescape = (text: string) =>
    text
      .replaceAll("&lt;", "<")
      .replaceAll("&gt;", ">")
      .replaceAll("&quot;", '"')
      .replaceAll("&apos;", "'")
      .replaceAll("&amp;", "&");
  const read = (): PlistValue => {
    const tag = tokens[index++];
    if (tag === "<dict>") {
      const dict: { [key: string]: PlistValue } = {};
      while (tokens[index] !== "</dict>") {
        index++;
        const key = tokens[index++];
        index++;
        dict[key] = read();
      }
      index++;
      return dict;
    }
    if (tag === "<array>") {
      const items: PlistValue[] = [];
      while (tokens[index] !== "</array>") items.push(read());
      index++;
      return items;
    }
    const text = tokens[index++];
    index++;
    return tag === "<integer>" ? Number(text) : unescape(text);
  };
  return read();
}

describe("renderPlist", () => {
  it("carries exactly the desired registration, with every string escaped", () => {
    const hostile = desired({
      cwd: "/a&b/<c>/'d' \"e\"",
      path: "/x&y:/bin",
      programArguments: ["/bin/node", "/a b/cli.js", "-j", "/p&q/r.yml"],
    });

    expect(parsePlist(renderPlist("com.fifthrevision.axle.abc123", hostile))).toEqual({
      Label: "com.fifthrevision.axle.abc123",
      ProgramArguments: ["/bin/node", "/a b/cli.js", "-j", "/p&q/r.yml"],
      WorkingDirectory: "/a&b/<c>/'d' \"e\"",
      StartInterval: 3600,
      EnvironmentVariables: { PATH: "/x&y:/bin" },
      StandardOutPath: hostile.stdoutPath,
      StandardErrorPath: hostile.stderrPath,
    });
  });
});

describe("launchd backend apply", () => {
  it("creates the log directory, writes a world-readable plist, and bootstraps into gui/<uid>", async () => {
    const launchctl = new FakeLaunchctl();
    launchctl.replies = [() => NOT_LOADED];

    const binding = await backendWith(launchctl).apply(desired());

    const plistPath = join(LAUNCH_AGENTS, "com.fifthrevision.axle.abc123.plist");
    expect(binding).toEqual({ kind: "launchd", label: "com.fifthrevision.axle.abc123", plistPath });
    expect(launchctl.calls).toEqual([
      ["bootout", "gui/501/com.fifthrevision.axle.abc123"],
      ["bootstrap", "gui/501", plistPath],
    ]);
    expect(await readFile(plistPath, "utf-8")).toBe(renderPlist(binding.label, desired()));
    expect((await stat(plistPath)).mode & 0o777).toBe(0o644);
    expect((await stat(join(HOME, ".axle", "logs", "schedules"))).isDirectory()).toBe(true);
  });

  it("removes its plist when the first bootstrap fails", async () => {
    const launchctl = new FakeLaunchctl();
    launchctl.replies = [
      () => NOT_LOADED,
      () => ({ code: 5, stdout: "", stderr: "Bootstrap failed: 5: Input/output error" }),
    ];

    await expect(backendWith(launchctl).apply(desired())).rejects.toThrow(
      /bootstrap .* failed \(5\): Bootstrap failed: 5: Input\/output error/,
    );

    await expect(readdir(LAUNCH_AGENTS)).resolves.toEqual([]);
  });

  it("updates in place by booting out the previous label and rewriting the plist", async () => {
    const launchctl = new FakeLaunchctl();
    const backend = backendWith(launchctl);
    const first = await backend.apply(desired());
    launchctl.calls = [];

    const updated = await backend.apply(desired({ intervalSeconds: 900 }), first);

    expect(updated).toEqual(first);
    expect(launchctl.calls).toEqual([
      ["bootout", "gui/501/com.fifthrevision.axle.abc123"],
      ["bootout", "gui/501/com.fifthrevision.axle.abc123"],
      ["bootstrap", "gui/501", first.plistPath],
    ]);
    expect(await readFile(first.plistPath, "utf-8")).toContain("<integer>900</integer>");
    expect(await readdir(LAUNCH_AGENTS)).toEqual(["com.fifthrevision.axle.abc123.plist"]);
  });

  it("restores the previous plist and reloads it when an update fails to bootstrap", async () => {
    const launchctl = new FakeLaunchctl();
    const backend = backendWith(launchctl);
    const first = await backend.apply(desired());
    const originalPlist = await readFile(first.plistPath, "utf-8");
    launchctl.calls = [];
    launchctl.replies = [
      () => OK,
      () => NOT_LOADED,
      () => ({ code: 5, stdout: "", stderr: "Bootstrap failed: 5: Input/output error" }),
    ];

    await expect(backend.apply(desired({ intervalSeconds: 900 }), first)).rejects.toThrow(
      /bootstrap .* failed/,
    );

    expect(await readFile(first.plistPath, "utf-8")).toBe(originalPlist);
    expect(launchctl.calls.at(-1)).toEqual(["bootstrap", "gui/501", first.plistPath]);
  });

  it("surfaces a bootout failure that is not a missing service", async () => {
    const launchctl = new FakeLaunchctl();
    launchctl.replies = [
      () => ({ code: 1, stdout: "", stderr: "Boot-out failed: 1: Operation not permitted" }),
    ];

    await expect(backendWith(launchctl).apply(desired())).rejects.toThrow(
      /Operation not permitted/,
    );
    await expect(readdir(LAUNCH_AGENTS)).resolves.toEqual([]);
  });
});

describe("launchd backend remove", () => {
  it("boots out the label and deletes only its own plist", async () => {
    const launchctl = new FakeLaunchctl();
    const backend = backendWith(launchctl);
    const binding = await backend.apply(desired());
    const foreign = join(LAUNCH_AGENTS, "com.example.other.plist");
    await writeFile(foreign, "<plist/>");
    const sibling = await backend.apply(desired({ id: "def456" }));
    launchctl.calls = [];

    await backend.remove(binding);

    expect(launchctl.calls).toEqual([["bootout", "gui/501/com.fifthrevision.axle.abc123"]]);
    expect((await readdir(LAUNCH_AGENTS)).sort()).toEqual([
      "com.example.other.plist",
      "com.fifthrevision.axle.def456.plist",
    ]);
    expect(await readFile(sibling.plistPath, "utf-8")).toContain("def456");
  });

  it("tolerates a service that is already unloaded", async () => {
    const launchctl = new FakeLaunchctl();
    const backend = backendWith(launchctl);
    const binding = await backend.apply(desired());
    launchctl.replies = [() => NOT_LOADED];

    await backend.remove(binding);

    await expect(readdir(LAUNCH_AGENTS)).resolves.toEqual([]);
  });

  it("keeps the plist when bootout fails for another reason", async () => {
    const launchctl = new FakeLaunchctl();
    const backend = backendWith(launchctl);
    const binding = await backend.apply(desired());
    launchctl.replies = [
      () => ({ code: 1, stdout: "", stderr: "Boot-out failed: 1: Operation not permitted" }),
    ];

    await expect(backend.remove(binding)).rejects.toThrow(/bootout .* failed \(1\)/);

    expect(await readdir(LAUNCH_AGENTS)).toEqual(["com.fifthrevision.axle.abc123.plist"]);
  });
});

describe("launchd backend isLoaded", () => {
  it("is true only when the plist exists and launchctl can print the service", async () => {
    const launchctl = new FakeLaunchctl();
    const backend = backendWith(launchctl);
    const binding = await backend.apply(desired());
    launchctl.calls = [];

    expect(await backend.isLoaded(binding)).toBe(true);
    expect(launchctl.calls).toEqual([["print", "gui/501/com.fifthrevision.axle.abc123"]]);

    launchctl.replies = [() => ({ code: 113, stdout: "", stderr: "Could not find service" })];
    expect(await backend.isLoaded(binding)).toBe(false);

    await rm(binding.plistPath);
    launchctl.calls = [];
    expect(await backend.isLoaded(binding)).toBe(false);
    expect(launchctl.calls).toEqual([]);
  });
});

describe("createScheduleBackends", () => {
  it("offers launchd on darwin only and resolves launchd bindings by kind", () => {
    const backends = createScheduleBackends({ run: async () => OK, home: HOME, uid: 501 });

    expect(backends.forPlatform("darwin")?.kind).toBe("launchd");
    expect(backends.forPlatform("linux")).toBeUndefined();
    expect(backends.forPlatform("win32")).toBeUndefined();
    expect(backends.forKind("launchd")?.kind).toBe("launchd");
    expect(backends.forKind("systemd")).toBeUndefined();
  });
});
