import * as z from "zod";
import { replaceVariables } from "../utils/replace.js";
import type { Instruct } from "./Instruct.js";
import { zodToExample } from "./parse.js";

export function compileInstruct(
  instruct: Instruct,
  variables: Record<string, string> = {},
): string {
  const allVars = { ...variables, ...instruct.inputs };
  let message = replaceVariables(instruct.prompt, allVars);

  if (instruct.textReferences.length > 0) {
    for (const [index, ref] of instruct.textReferences.entries()) {
      const referenceTitle = ref.name ? `: ${ref.name}` : "";
      message += `\n\n## Reference ${index + 1}${referenceTitle}\n\n\`\`\`${ref.content}'''`;
    }
  }

  let instructions = "# Instructions\n\n";

  const schemaKeys = instruct.schema ? Object.keys(instruct.schema) : [];
  if (schemaKeys.length > 0) {
    instructions += "## Output Format Instructions\n";
    instructions +=
      "\nHere is how you should format your output. Follow the instructions strictly.\n";

    for (const [key, fieldSchema] of Object.entries(instruct.schema!)) {
      const [value, example] = zodToExample(fieldSchema as z.ZodTypeAny);
      instructions += `\n- Use <${key}></${key}> tags to indicate the answer for ${key}. The answer must be a ${value}.\n  Example: <${key}>${JSON.stringify(example)}</${key}>\n`;
    }
  }

  if (instruct.instructions.length > 0) {
    instructions += "\n## Additional Instructions\n\n";
    for (const instruction of instruct.instructions) {
      instructions += `- ${instruction}\n`;
    }
  }

  return instructions + message;
}
