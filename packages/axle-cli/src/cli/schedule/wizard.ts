import * as clack from "@clack/prompts";
import { readFile } from "node:fs/promises";
import YAML from "yaml";
import { writeFileAtomic } from "../atomic-write.js";
import { parseInterval } from "./duration.js";

/**
 * Insert `schedule.every` into a recipe, re-emitting the parsed document so
 * unrelated keys and comments survive.
 */
export async function writeScheduleBlock(recipePath: string, every: string): Promise<void> {
  const doc = YAML.parseDocument(await readFile(recipePath, "utf-8"));
  doc.setIn(["schedule", "every"], every);
  await writeFileAtomic(recipePath, doc.toString());
}

export async function promptForInterval(recipePath: string): Promise<string | undefined> {
  clack.intro("axle schedule");
  clack.log.info(`${recipePath} has no schedule block.`);
  const every = await clack.text({
    message: "Run every (e.g. 15m, 1h, 2d)",
    placeholder: "1h",
    validate: (value) => {
      try {
        parseInterval((value ?? "").trim());
        return undefined;
      } catch (e) {
        return e instanceof Error ? e.message : String(e);
      }
    },
  });
  if (clack.isCancel(every)) {
    clack.outro("No schedule added.");
    return undefined;
  }
  const interval = String(every).trim();
  clack.log.step(`Adding to ${recipePath}:\n\nschedule:\n  every: ${interval}`);
  const confirmed = await clack.confirm({ message: "Write this block and register the schedule?" });
  if (clack.isCancel(confirmed) || !confirmed) {
    clack.outro("No schedule added.");
    return undefined;
  }
  clack.outro("Schedule block written.");
  return interval;
}
