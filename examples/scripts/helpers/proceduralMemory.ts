import type { AgentMemory, MemoryContext } from "@fifthrevision/axle";

export class ProceduralMemory implements AgentMemory {
  private instructions: string[] = [];

  async recall() {
    if (this.instructions.length === 0) return {};
    const numbered = this.instructions.map((instruction, index) => `${index + 1}. ${instruction}`);
    return { systemSuffix: `## Learned Instructions\n\n${numbered.join("\n")}` };
  }

  async record(context: MemoryContext) {
    const latestCorrection = [...context.messages]
      .reverse()
      .find((message) => message.role === "user" && message.content.toString().includes("Always"));
    if (!latestCorrection || typeof latestCorrection.content !== "string") return;
    if (!this.instructions.includes(latestCorrection.content)) {
      this.instructions.push(latestCorrection.content);
    }
  }
}
