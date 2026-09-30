import { describe, expect, it } from "vitest";
import {
  describeNextFiring,
  formatInterval,
  formatTrigger,
  MAX_INTERVAL_SECONDS,
  nextFiring,
  parseClockTime,
  parseInterval,
  parseScheduleTrigger,
} from "../../../src/cli/schedule/trigger.js";

// 2026-09-17 is a Thursday; local time throughout, like launchd.
const thursday = (hour: number, minute: number) => new Date(2026, 8, 17, hour, minute);

describe("parseScheduleTrigger", () => {
  it("maps every to an interval", () => {
    expect(parseScheduleTrigger({ every: "15m" })).toEqual({ kind: "interval", seconds: 900 });
  });

  it("normalizes calendar times and weekdays: sorted, deduplicated", () => {
    expect(
      parseScheduleTrigger({ at: ["17:30", "09:00", "09:00"], on: ["fri", "mon", "mon"] }),
    ).toEqual({
      kind: "calendar",
      times: [
        { hour: 9, minute: 0 },
        { hour: 17, minute: 30 },
      ],
      weekdays: [1, 5],
    });
    expect(parseScheduleTrigger({ at: "09:00" })).toEqual({
      kind: "calendar",
      times: [{ hour: 9, minute: 0 }],
    });
  });

  it.each(["9:00", "09:00:00", "9am", "24:00", "09:60", ""])("rejects time %j", (text) => {
    expect(() => parseClockTime(text)).toThrow(/expected HH:MM/);
  });
});

describe("formatTrigger", () => {
  it("renders each shape", () => {
    expect(formatTrigger({ kind: "interval", seconds: 3600 })).toBe("every 1h");
    expect(formatTrigger({ kind: "calendar", times: [{ hour: 9, minute: 0 }] })).toBe("at 09:00");
    expect(
      formatTrigger({
        kind: "calendar",
        times: [
          { hour: 9, minute: 0 },
          { hour: 17, minute: 30 },
        ],
        weekdays: [1, 5],
      }),
    ).toBe("at 09:00, 17:30 on mon,fri");
  });
});

describe("nextFiring", () => {
  it("adds the interval", () => {
    expect(nextFiring({ kind: "interval", seconds: 900 }, thursday(10, 0))).toEqual(
      thursday(10, 15),
    );
  });

  it("picks the next time today, else the first time on a later allowed day", () => {
    const daily = {
      kind: "calendar" as const,
      times: [
        { hour: 9, minute: 0 },
        { hour: 17, minute: 30 },
      ],
    };
    expect(nextFiring(daily, thursday(10, 0))).toEqual(thursday(17, 30));
    expect(nextFiring(daily, thursday(17, 30))).toEqual(new Date(2026, 8, 18, 9, 0));

    const weekdaysOnly = { ...daily, weekdays: [1, 5] };
    expect(nextFiring(weekdaysOnly, thursday(10, 0))).toEqual(new Date(2026, 8, 18, 9, 0));
    expect(nextFiring({ ...daily, weekdays: [3] }, thursday(10, 0))).toEqual(
      new Date(2026, 8, 23, 9, 0),
    );
  });

  it("describes the next firing for messages", () => {
    expect(describeNextFiring({ kind: "interval", seconds: 3600 }, thursday(10, 0))).toBe("in 1h");
    expect(
      describeNextFiring(
        { kind: "calendar", times: [{ hour: 9, minute: 0 }], weekdays: [1] },
        thursday(10, 0),
      ),
    ).toBe("Mon 09:00");
  });
});

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
