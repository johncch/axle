import type { ScheduleConfig } from "../configs/schemas.js";
import { formatInterval, parseInterval } from "./duration.js";

export interface ClockTime {
  hour: number;
  minute: number;
}

/** 0 = Sunday … 6 = Saturday, matching `Date#getDay` and launchd's `Weekday`. */
export const WEEKDAY_NAMES = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
export type WeekdayName = (typeof WEEKDAY_NAMES)[number];

export type ScheduleTrigger =
  | { kind: "interval"; seconds: number }
  | { kind: "calendar"; times: ClockTime[]; weekdays?: number[] };

export const CLOCK_TIME_PATTERN = "^([01][0-9]|2[0-3]):[0-5][0-9]$";

export function parseClockTime(text: string): ClockTime {
  if (!new RegExp(CLOCK_TIME_PATTERN).test(text)) {
    throw new Error(`Invalid time "${text}": expected HH:MM in 24-hour form (for example 09:00).`);
  }
  const [hour, minute] = text.split(":").map(Number);
  return { hour, minute };
}

export function parseScheduleTrigger(config: ScheduleConfig): ScheduleTrigger {
  if ("every" in config) return { kind: "interval", seconds: parseInterval(config.every) };

  const times = (Array.isArray(config.at) ? config.at : [config.at])
    .map(parseClockTime)
    .sort((a, b) => a.hour - b.hour || a.minute - b.minute)
    .filter((time, index, all) => index === 0 || !sameTime(time, all[index - 1]));
  if (!config.on) return { kind: "calendar", times };

  const weekdays = [...new Set(config.on.map((name) => WEEKDAY_NAMES.indexOf(name)))].sort(
    (a, b) => a - b,
  );
  return { kind: "calendar", times, weekdays };
}

export function formatTrigger(trigger: ScheduleTrigger): string {
  if (trigger.kind === "interval") return `every ${formatInterval(trigger.seconds)}`;
  const at = `at ${trigger.times.map(formatClockTime).join(", ")}`;
  if (!trigger.weekdays) return at;
  return `${at} on ${trigger.weekdays.map((day) => WEEKDAY_NAMES[day]).join(",")}`;
}

export function formatClockTime(time: ClockTime): string {
  return `${String(time.hour).padStart(2, "0")}:${String(time.minute).padStart(2, "0")}`;
}

/** Machine-local time, as launchd evaluates `StartCalendarInterval`. */
export function nextFiring(trigger: ScheduleTrigger, now: Date): Date {
  if (trigger.kind === "interval") return new Date(now.getTime() + trigger.seconds * 1000);

  for (let dayOffset = 0; dayOffset <= 7; dayOffset++) {
    for (const time of trigger.times) {
      const candidate = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() + dayOffset,
        time.hour,
        time.minute,
      );
      if (candidate <= now) continue;
      if (trigger.weekdays && !trigger.weekdays.includes(candidate.getDay())) continue;
      return candidate;
    }
  }
  throw new Error("Calendar schedule has no firing within a week.");
}

export function describeNextFiring(trigger: ScheduleTrigger, now: Date): string {
  if (trigger.kind === "interval") return `in ${formatInterval(trigger.seconds)}`;
  const next = nextFiring(trigger, now);
  const weekday = WEEKDAY_NAMES[next.getDay()];
  return `${weekday[0].toUpperCase()}${weekday.slice(1)} ${formatClockTime({ hour: next.getHours(), minute: next.getMinutes() })}`;
}

function sameTime(a: ClockTime, b: ClockTime): boolean {
  return a.hour === b.hour && a.minute === b.minute;
}
