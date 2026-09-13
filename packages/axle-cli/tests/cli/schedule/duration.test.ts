import { describe, expect, it } from "vitest";
import {
  formatInterval,
  MAX_INTERVAL_SECONDS,
  parseInterval,
} from "../../../src/cli/schedule/duration.js";

describe("parseInterval", () => {
  it.each([
    ["60s", 60],
    ["15m", 900],
    ["1h", 3600],
    ["2d", 172_800],
  ])("parses %s", (every, seconds) => {
    expect(parseInterval(every)).toBe(seconds);
  });

  it.each(["", "1", "h", "1.5h", "1h30m", " 1h", "1h ", "1H", "01h", "-1h", "+1h", "1w"])(
    "rejects grammar %j",
    (every) => {
      expect(() => parseInterval(every)).toThrow(/expected <positive integer><unit>/);
    },
  );

  it("rejects intervals under 60 seconds", () => {
    expect(() => parseInterval("59s")).toThrow(/minimum is 60s/);
    expect(() => parseInterval("1s")).toThrow(/minimum is 60s/);
  });

  it("rejects intervals a backend cannot hold", () => {
    expect(parseInterval(`${MAX_INTERVAL_SECONDS}s`)).toBe(MAX_INTERVAL_SECONDS);
    expect(() => parseInterval(`${MAX_INTERVAL_SECONDS + 1}s`)).toThrow(/maximum is/);
    expect(() => parseInterval("99999999999999999999d")).toThrow(/maximum is/);
  });
});

describe("formatInterval", () => {
  it.each([
    [60, "1m"],
    [900, "15m"],
    [3600, "1h"],
    [5400, "90m"],
    [172_800, "2d"],
    [61, "61s"],
  ])("formats %d seconds as %s", (seconds, every) => {
    expect(formatInterval(seconds)).toBe(every);
  });
});
