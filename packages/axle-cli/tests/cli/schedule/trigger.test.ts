import { describe, expect, it } from "vitest";
import {
  describeNextFiring,
  formatTrigger,
  nextFiring,
  parseClockTime,
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
