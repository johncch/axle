import { replaceFilePattern, writeFileWithDirectories } from "../utils/file.js";
import { replaceVariables } from "../utils/replace.js";
import type { FilePathInfo } from "../utils/types.js";
import type { Action, ActionContext } from "./types.js";

/**
 * WriteToDisk Action
 *
 * Writes content to a file on disk. This action is typically used as a workflow
 * step following an LLM call to persist the generated output.
 *
 * ## CLI Job Definition (YAML)
 *
 * In job YAML files, use the `write-to-disk` step type:
 *
 * ```yaml
 * steps:
 *   - uses: chat
 *     message: Generate a greeting for {{name}}
 *   - uses: write-to-disk
 *     output: ./output/greeting-{{name}}.txt
 * ```
 *
 * ### Properties
 *
 * | Property | Type                 | Required | Description                                      |
 * |----------|----------------------|----------|--------------------------------------------------|
 * | `uses`   | `"write-to-disk"`    | Yes      | Identifies this as a WriteToDisk step            |
 * | `output` | `string`             | Yes      | File path template (supports `{{}}` placeholders)|
 * | `keys`   | `string \| string[]` | No       | Variable keys to include in output content       |
 *
 * ### Examples
 *
 * **Basic usage** - writes the LLM response to a file:
 * ```yaml
 * - uses: write-to-disk
 *   output: ./output/result.txt
 * ```
 *
 * **With path variables** - uses `{{}}` placeholders in path:
 * ```yaml
 * - uses: write-to-disk
 *   output: ./output/greeting-{{name}}.txt
 * ```
 *
 * **With file pattern** (batch processing) - uses `*` to substitute file stem:
 * ```yaml
 * - uses: write-to-disk
 *   output: ./output/results-*.txt
 * ```
 *
 * **With specific keys** - outputs only specified variables:
 * ```yaml
 * - uses: write-to-disk
 *   output: ./output/summary.txt
 *   keys: summary
 * ```
 *
 * **With multiple keys** - outputs multiple variables, each on a new line:
 * ```yaml
 * - uses: write-to-disk
 *   output: ./output/report.txt
 *   keys:
 *     - title
 *     - summary
 *     - conclusion
 * ```
 *
 * ## Placeholder Styles
 *
 * This action uses `{{variable}}` placeholder style for all variable substitution:
 *
 * - **Path template** (`output`): Uses `{{variable}}` placeholders
 *   - Example: `./output/greeting-{{name}}.txt`
 *   - Also supports `*` for file stem substitution in batch processing
 *
 * - **Content template** (`keys`): Uses `{{variable}}` placeholders
 *   - Default template: `{{response}}`
 *   - When `keys` is specified, generates: `{{key1}}\n{{key2}}\n...`
 *
 * ## Variables Available
 *
 * All variables from the workflow context are available for substitution:
 * - `response` - The text response from the previous LLM step
 * - `$previous` - The full output object from the previous step
 * - `file` - File info object when processing batches (contains `stem`, `name`, `ext`, etc.)
 * - Any custom variables defined in the workflow or extracted by previous steps
 *
 * @see WriteToDiskStep in `src/cli/configs/types.ts` for the TypeScript interface
 * @see writeToDiskConverter in `src/cli/converters/writeToDisk.ts` for CLI conversion logic
 */
export class WriteToDisk implements Action {
  name = "write-to-disk";

  /**
   * Creates a new WriteToDisk action.
   *
   * @param pathTemplate - The file path template. Supports:
   *   - `{{variable}}` placeholders for variable substitution
   *   - `*` for file stem substitution (batch processing)
   * @param contentTemplate - The content template using `{{variable}}` placeholders.
   *   Defaults to `{{response}}` to output the LLM response.
   */
  constructor(
    private pathTemplate: string,
    private contentTemplate: string = "{{response}}",
  ) {}

  /**
   * Executes the write-to-disk action.
   *
   * Resolves the path and content templates using workflow variables,
   * then writes the content to the resolved file path.
   *
   * @param context - The action execution context containing:
   *   - `variables`: All workflow variables available for substitution
   *   - `options`: Execution options (e.g., `dryRun`)
   *   - `recorder`: Optional recorder for logging
   * @returns A promise that resolves when the file has been written
   */
  async execute(context: ActionContext): Promise<void> {
    const { variables, options, tracer } = context;

    if (options?.dryRun) {
      tracer?.info(`[Dry run] WriteToDisk not executed.`);
      return;
    }

    // Resolve the file path
    // If path contains *, use file pattern replacement (batch processing)
    // Otherwise use {{}} placeholder substitution
    let filepath: string;
    if (this.pathTemplate.includes("*")) {
      filepath = replaceFilePattern(this.pathTemplate, variables.file as FilePathInfo);
    } else {
      filepath = replaceVariables(this.pathTemplate, variables, "{{}}");
    }

    // Resolve the content using {{}} placeholder style
    const content = replaceVariables(this.contentTemplate, variables, "{{}}");

    await writeFileWithDirectories({
      filePath: filepath,
      content,
    });

    tracer?.info(`Wrote to ${filepath}`);
  }
}
