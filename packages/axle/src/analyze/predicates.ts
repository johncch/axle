import type { AnySegment } from "./types.js";

export function failed(segment: AnySegment): boolean {
  return "status" in segment && segment.status === "error";
}

export function completed(segment: AnySegment): boolean {
  return "status" in segment && segment.status === "complete";
}

export function cancelled(segment: AnySegment): boolean {
  return "status" in segment && segment.status === "cancelled";
}

export function byUser(segment: AnySegment): boolean {
  return segment.kind === "turn" && segment.owner === "user";
}

export function byAgent(segment: AnySegment): boolean {
  return segment.kind === "turn" && segment.owner === "agent";
}

export function named(name: string): (segment: AnySegment) => boolean {
  return (segment) => "name" in segment && segment.name === name;
}
