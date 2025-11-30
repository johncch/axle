import { access, constants } from "fs/promises";
import { replaceVariables } from "../../utils/replace.js";
import { FilePathInfo } from "../../utils/types.js";
import { SkipCondition } from "./types.js";

export class FileExistSkipCondition implements SkipCondition {
  type = "file-exist";
  constructor(public pattern: string) {}
  async eval(params: { components: FilePathInfo }): Promise<boolean> {
    const path = replaceVariables(this.pattern, params.components, "{{}}");
    try {
      await access(path, constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }
}
