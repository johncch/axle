import * as z from "zod";
import { Instruct } from "../../core/Instruct.js";
import type { TracingContext } from "../../tracer/types.js";
import { loadFileContent, loadManyFiles } from "../../utils/file.js";
import { arrayify } from "../../utils/utils.js";
import type { ChatStep, ToolProviderConfig } from "../configs/schemas.js";
import { createTools } from "../factories.js";
import type { StepToClassConverter } from "./converters.js";

type SchemaRecord = Record<string, z.ZodTypeAny>;

export const chatConverter: StepToClassConverter<ChatStep, Instruct<SchemaRecord>> = {
  async convert(
    step: ChatStep,
    context: { tracer?: TracingContext; toolNames?: string[]; toolConfig?: ToolProviderConfig },
  ): Promise<Instruct<SchemaRecord>> {
    const { tracer, toolNames, toolConfig } = context;
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

    const allToolNames = [...new Set([...(toolNames ?? []), ...(step.tools ?? [])])];
    if (allToolNames.length > 0) {
      const tools = createTools(allToolNames, toolConfig);
      instruct.addTools(tools);
    }

    if (replace) {
      for (const r of replace) {
        if (r.source === "file") {
          const filenames = arrayify(r.files);
          const replacements = await loadManyFiles(filenames, tracer);
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
          throw new Error(`Failed to load image '${imageRef.file}': ${error.message}`);
        }
      }
    }

    if (step.documents) {
      for (const documentRef of step.documents) {
        try {
          const fileInfo = await loadFileContent(documentRef.file, "base64");
          instruct.addFile(fileInfo);
        } catch (error) {
          throw new Error(`Failed to load document '${documentRef.file}': ${error.message}`);
        }
      }
    }

    if (step.references) {
      for (const ref of step.references) {
        try {
          const fileInfo = await loadFileContent(ref.file, "utf-8");
          instruct.addReference(fileInfo);
        } catch (error) {
          throw new Error(`Failed to load reference file '${ref.file}': ${error.message}`);
        }
      }
    }

    return instruct;
  },
};
