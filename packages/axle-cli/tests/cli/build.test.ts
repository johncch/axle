import { describe, expect, it } from "vitest";
import pkg from "../../package.json";
import { resolveBuildInfo } from "../../src/cli/build.js";

describe("resolveBuildInfo", () => {
  it("reports a source run when the entry file is TypeScript", () => {
    expect(resolveBuildInfo("file:///repo/packages/axle-cli/src/cli.ts")).toEqual({
      version: pkg.version,
      detail: "source",
    });
  });

  it("reports the plain version for a built entry with no stamp", () => {
    expect(resolveBuildInfo("file:///repo/packages/axle-cli/dist/cli.js")).toEqual({
      version: pkg.version,
    });
  });
});
