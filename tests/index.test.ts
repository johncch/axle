import { describe, expect, it } from "vitest";
import * as axle from "../src/index.js";

describe("public exports", () => {
  it("exports primary runtime classes and errors", () => {
    expect(axle.Agent).toBeTypeOf("function");
    expect(axle.Instruct).toBeTypeOf("function");
    expect(axle.MCP).toBeTypeOf("function");
    expect(axle.AxleError).toBeTypeOf("function");
    expect(axle.AxleAbortError).toBeTypeOf("function");
    expect(axle.AxleAgentAbortError).toBeTypeOf("function");
    expect(axle.AxleToolFatalError).toBeTypeOf("function");
  });
});
