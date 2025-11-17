import { Executable, ExecutableTask } from "../../types.js";

export interface WriteToDiskTask extends ExecutableTask {
  type: "write-to-disk";
  output: string;
  keys: string[];
}

export class WriteOutputTask implements WriteToDiskTask {
  type = "write-to-disk" as const;
  _executable!: Executable; // Definite assignment assertion - set by converter

  constructor(
    public output: string,
    public keys: string[] = ["response"],
  ) {}
}
