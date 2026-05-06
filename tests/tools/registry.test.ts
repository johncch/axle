import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ToolRegistry } from "../../src/tools/registry.js";
import type { ExecutableTool, ProviderTool } from "../../src/tools/types.js";

function makeExec(name: string): ExecutableTool {
  return {
    name,
    description: `tool ${name}`,
    schema: z.object({}),
    async execute() {
      return "";
    },
  };
}

function makeProvider(name: string): ProviderTool {
  return { type: "provider", name };
}

describe("ToolRegistry", () => {
  describe("construction", () => {
    it("starts empty when constructed with no args", () => {
      const r = new ToolRegistry();
      expect(r.size).toBe(0);
      expect(r.executable()).toEqual([]);
      expect(r.provider()).toEqual([]);
    });

    it("seeds executable tools from the constructor", () => {
      const a = makeExec("a");
      const r = new ToolRegistry({ tools: [a] });
      expect(r.size).toBe(1);
      expect(r.executable()).toEqual([a]);
    });

    it("seeds provider tools from the constructor", () => {
      const p = makeProvider("p");
      const r = new ToolRegistry({ providerTools: [p] });
      expect(r.size).toBe(1);
      expect(r.provider()).toEqual([p]);
    });

    it("seeds both kinds from the constructor", () => {
      const a = makeExec("a");
      const p = makeProvider("p");
      const r = new ToolRegistry({ tools: [a], providerTools: [p] });
      expect(r.size).toBe(2);
      expect(r.executable()).toEqual([a]);
      expect(r.provider()).toEqual([p]);
    });
  });

  describe("add (executable)", () => {
    it("adds a single tool", () => {
      const r = new ToolRegistry();
      r.add(makeExec("a"));
      expect(r.has("a")).toBe(true);
      expect(r.size).toBe(1);
    });

    it("adds an array of tools", () => {
      const r = new ToolRegistry();
      r.add([makeExec("a"), makeExec("b")]);
      expect(r.size).toBe(2);
    });

    it("throws on duplicate name within executable bucket", () => {
      const r = new ToolRegistry({ tools: [makeExec("a")] });
      expect(() => r.add(makeExec("a"))).toThrow(/already registered/);
    });

    it("throws on duplicate name across buckets", () => {
      const r = new ToolRegistry({ providerTools: [makeProvider("shared")] });
      expect(() => r.add(makeExec("shared"))).toThrow(/already registered/);
    });
  });

  describe("addProvider", () => {
    it("adds a single provider tool", () => {
      const r = new ToolRegistry();
      r.addProvider(makeProvider("p"));
      expect(r.has("p")).toBe(true);
      expect(r.provider().map((t) => t.name)).toEqual(["p"]);
    });

    it("adds an array of provider tools", () => {
      const r = new ToolRegistry();
      r.addProvider([makeProvider("p1"), makeProvider("p2")]);
      expect(r.size).toBe(2);
    });

    it("throws on duplicate name across buckets", () => {
      const r = new ToolRegistry({ tools: [makeExec("shared")] });
      expect(() => r.addProvider(makeProvider("shared"))).toThrow(/already registered/);
    });
  });

  describe("remove", () => {
    it("removes an executable tool and returns true", () => {
      const r = new ToolRegistry({ tools: [makeExec("a")] });
      expect(r.remove("a")).toBe(true);
      expect(r.has("a")).toBe(false);
      expect(r.size).toBe(0);
    });

    it("removes a provider tool and returns true", () => {
      const r = new ToolRegistry({ providerTools: [makeProvider("p")] });
      expect(r.remove("p")).toBe(true);
      expect(r.has("p")).toBe(false);
    });

    it("returns false for missing tool", () => {
      const r = new ToolRegistry();
      expect(r.remove("missing")).toBe(false);
    });
  });

  describe("get / getProvider", () => {
    it("get returns the executable tool when present", () => {
      const a = makeExec("a");
      const r = new ToolRegistry({ tools: [a] });
      expect(r.get("a")).toBe(a);
    });

    it("get returns undefined for a provider tool name", () => {
      const r = new ToolRegistry({ providerTools: [makeProvider("p")] });
      expect(r.get("p")).toBeUndefined();
    });

    it("getProvider returns the provider tool when present", () => {
      const p = makeProvider("p");
      const r = new ToolRegistry({ providerTools: [p] });
      expect(r.getProvider("p")).toBe(p);
    });

    it("getProvider returns undefined for an executable name", () => {
      const r = new ToolRegistry({ tools: [makeExec("a")] });
      expect(r.getProvider("a")).toBeUndefined();
    });
  });

  describe("listings", () => {
    it("executable() and provider() return only their bucket", () => {
      const r = new ToolRegistry({
        tools: [makeExec("e1"), makeExec("e2")],
        providerTools: [makeProvider("p1")],
      });
      expect(r.executable().map((t) => t.name)).toEqual(["e1", "e2"]);
      expect(r.provider().map((t) => t.name)).toEqual(["p1"]);
    });
  });
});
