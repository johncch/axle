import { Executable } from "../types.js";

export class ExecutableRegistry {
  private executables: Map<string, Executable> = new Map();

  register(executable: Executable): void {
    if (this.executables.has(executable.name)) {
      throw new Error(
        `Executable with name '${executable.name}' is already registered`,
      );
    }

    this.executables.set(executable.name, executable);
  }

  get(name: string): Executable {
    const executable = this.executables.get(name);
    if (!executable) {
      throw new Error(`Executable '${name}' is not registered`);
    }
    return executable;
  }

  has(name: string): boolean {
    return this.executables.has(name);
  }

  getAll(): Executable[] {
    return Array.from(this.executables.values());
  }
}
