import { ToolRegistry } from "@fifthrevision/axle";
import { describe, expect, it } from "vitest";
import helpTool, { HELP_TOPICS } from "../../src/tools/help.js";

const ctx = {
  signal: new AbortController().signal,
  registry: new ToolRegistry(),
  emit: () => {},
};

describe("axle-help tool", () => {
  it("defaults to the overview", async () => {
    const result = await helpTool.execute(helpTool.schema.parse({}), ctx);
    expect(result).toContain("# axle");
    expect(result).toContain("axle batch");
  });

  it("returns every topic the schema lists", async () => {
    for (const topic of HELP_TOPICS) {
      const result = await helpTool.execute({ topic }, ctx);
      expect(result.length).toBeGreaterThan(200);
    }
  });

  it("rejects an unknown topic", () => {
    expect(() => helpTool.schema.parse({ topic: "nope" })).toThrow();
  });
});
