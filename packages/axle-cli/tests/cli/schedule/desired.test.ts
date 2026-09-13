import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildDesiredSchedule,
  occurrenceArguments,
  resolveRelaunchArgv,
} from "../../../src/cli/schedule/desired.js";

describe("resolveRelaunchArgv", () => {
  it("re-enters the same node binary, loader flags, and entry script without a shell", () => {
    const argv = resolveRelaunchArgv({
      execPath: "/opt/node/bin/node",
      execArgv: ["--import", "/repo/node_modules/tsx/dist/loader.mjs"],
      argv: ["/opt/node/bin/node", "packages/axle-cli/src/cli.ts", "-j", "x.yml"],
    });

    expect(argv).toEqual([
      "/opt/node/bin/node",
      "--import",
      "/repo/node_modules/tsx/dist/loader.mjs",
      join(process.cwd(), "packages/axle-cli/src/cli.ts"),
    ]);
  });

  it("keeps an absolute entry script as is", () => {
    expect(
      resolveRelaunchArgv({
        execPath: "/usr/local/bin/node",
        execArgv: [],
        argv: ["/usr/local/bin/node", "/usr/local/lib/axle/dist/cli.js"],
      }),
    ).toEqual(["/usr/local/bin/node", "/usr/local/lib/axle/dist/cli.js"]);
  });
});

describe("buildDesiredSchedule", () => {
  it("derives occurrence arguments and log paths from the identity", () => {
    const desired = buildDesiredSchedule({
      id: "abc123",
      name: "hourly-monitor",
      recipePath: "/Users/me/My Recipes/monitor.yml",
      cwd: "/Users/me/My Recipes",
      intervalSeconds: 3600,
      relaunch: ["/usr/local/bin/node", "/usr/local/lib/axle/dist/cli.js"],
      path: "/usr/local/bin:/usr/bin:/bin",
      home: "/Users/me",
    });

    expect(desired).toEqual({
      id: "abc123",
      name: "hourly-monitor",
      recipePath: "/Users/me/My Recipes/monitor.yml",
      cwd: "/Users/me/My Recipes",
      intervalSeconds: 3600,
      programArguments: [
        "/usr/local/bin/node",
        "/usr/local/lib/axle/dist/cli.js",
        "-j",
        "/Users/me/My Recipes/monitor.yml",
        "--renderer",
        "plain",
        "--no-log",
        "--scheduled",
        "abc123",
      ],
      path: "/usr/local/bin:/usr/bin:/bin",
      stdoutPath: "/Users/me/.axle/logs/schedules/abc123.out.log",
      stderrPath: "/Users/me/.axle/logs/schedules/abc123.err.log",
    });
  });

  it("never joins arguments into a shell string", () => {
    const args = occurrenceArguments(["/bin/node", "/a b/cli.js"], "id1", "/p q/r.yml");
    expect(args.some((arg) => arg.includes("sh -c") || arg.includes("&&"))).toBe(false);
    expect(args).toContain("/p q/r.yml");
  });
});
