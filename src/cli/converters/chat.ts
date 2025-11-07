import * as z from "zod";
import { Instruct } from "../../core/Instruct.js";
import { Recorder } from "../../recorder/recorder.js";
import { getToolRegistry } from "../../tools/index.js";
import { loadFileContent, loadManyFiles } from "../../utils/file.js";
import { arrayify } from "../../utils/utils.js";
import { ChatStep } from "../configs/types.js";
import { StepToClassConverter } from "./converters.js";

type SchemaRecord = Record<string, z.ZodTypeAny>;

export const chatConverter: StepToClassConverter<
  ChatStep,
  Instruct<SchemaRecord>
> = {
  async convert(
    step: ChatStep,
    context: { recorder?: Recorder; toolNames?: string[] },
  ): Promise<Instruct<SchemaRecord>> {
    const { recorder, toolNames } = context;
    const { message, system, replace } = step;

    let instruct: Instruct<SchemaRecord>;
    if (step.output) {
      instruct = Instruct.with(message, step.output);
    } else {
      instruct = Instruct.with(message);
    }
    if (system) {
      instruct.system = system;
    }

    const allToolNames = [
      ...new Set([...(toolNames ?? []), ...(step.tools ?? [])]),
    ];
    for (const toolName of allToolNames) {
      const tool = getToolRegistry().get(toolName);
      instruct.addTool(tool);
    }

    if (replace) {
      for (const r of replace) {
        if (r.source === "file") {
          const filenames = arrayify(r.files);
          const replacements = await loadManyFiles(filenames, recorder);
          instruct.addInput(r.pattern, replacements);
        }
      }
    }

    if (step.images) {
      for (const imageRef of step.images) {
        try {
          const fileInfo = await loadFileContent(imageRef.file, "base64");
          instruct.addFile(fileInfo);
        } catch (error) {
          throw new Error(
            `Failed to load image '${imageRef.file}': ${error.message}`,
          );
        }
      }
    }

    if (step.documents) {
      for (const documentRef of step.documents) {
        try {
          const fileInfo = await loadFileContent(documentRef.file, "base64");
          instruct.addFile(fileInfo);
        } catch (error) {
          throw new Error(
            `Failed to load document '${documentRef.file}': ${error.message}`,
          );
        }
      }
    }

    if (step.references) {
      for (const ref of step.references) {
        try {
          const fileInfo = await loadFileContent(ref.file, "utf-8");
          instruct.addReference(fileInfo);
        } catch (error) {
          throw new Error(
            `Failed to load reference file '${ref.file}': ${error.message}`,
          );
        }
      }
    }

    return instruct;
  },
};
