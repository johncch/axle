import { createHash } from "node:crypto";
import { realpath } from "node:fs/promises";
import { basename, extname } from "node:path";

export interface ScheduleIdentity {
  id: string;
  recipePath: string;
}

/**
 * A schedule's identity is its recipe's canonical absolute path: the same
 * file applied again is an update, a moved file is a new schedule. The path
 * must exist so symlinks and case collapse to one identity.
 */
export async function resolveScheduleIdentity(recipe: string): Promise<ScheduleIdentity> {
  const recipePath = await realpath(recipe);
  return { id: scheduleIdFor(recipePath), recipePath };
}

export function scheduleIdFor(recipePath: string): string {
  return createHash("sha256").update(recipePath).digest("hex").slice(0, 16);
}

export function displayNameFor(recipeName: string | undefined, recipePath: string): string {
  return recipeName ?? basename(recipePath, extname(recipePath));
}
