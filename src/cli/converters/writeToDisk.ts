import { WriteToDisk } from "../../actions/writeToDisk.js";
import { arrayify } from "../../utils/utils.js";
import type { WriteToDiskStep } from "../configs/schemas.js";
import { createWriteToDiskAction } from "../factories.js";
import type { StepToClassConverter } from "./converters.js";

export const writeToDiskConverter: StepToClassConverter<WriteToDiskStep, WriteToDisk> = {
  async convert(step: WriteToDiskStep): Promise<WriteToDisk> {
    const contentTemplate = step.keys
      ? arrayify(step.keys)
          .map((k) => `{{${k}}}`)
          .join("\n")
      : "{{response}}";
    return createWriteToDiskAction(step.output, contentTemplate);
  },
};
