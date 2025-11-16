import { Executable, Task } from "../../types.js";

export interface WriteToDiskTask extends Task {
  type: "write-to-disk";
  output: string;
  keys: string[];
}

export class WriteOutputTask implements WriteToDiskTask {
  type = "write-to-disk" as const;
  _executable?: Executable;

  constructor(
    public output: string,
    public keys: string[] = ["response"],
  ) {}
}
