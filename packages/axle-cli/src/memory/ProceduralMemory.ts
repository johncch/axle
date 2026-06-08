import {
  generate,
  type AgentMemory,
  type AIProvider,
  type AxleMessage,
  type ContentPart,
  type ExecutableTool,
  type FileStore,
  type MemoryContext,
  type RecallResult,
} from "@fifthrevision/axle";
import node_crypto from "node:crypto";
import { z } from "zod";

export interface ProceduralMemoryConfig {
  provider: AIProvider;
  model: string;
  enableTools?: boolean;
  store: FileStore;
  /** Memory-owned partition metadata, such as user or workspace ids. */
  scope?: Record<string, string>;
}

interface MemoryStore {
  instructions: string[];
}

const EXTRACTION_SYSTEM = `You are a memory extraction system. Your job is to extract learnings from a conversation that should be remembered for future runs.

Only extract:
- Explicit user corrections (e.g., "No, always use bullet points")
- Stated preferences (e.g., "I prefer concise summaries")
- Patterns that clearly emerged from user feedback

Do NOT extract:
- General knowledge or facts from the conversation content
- Inferences or speculation about what the user might want
- Task-specific details that won't apply to future runs

Respond with a JSON array of instruction strings. Each instruction should be a clear, actionable directive.
If there are no learnings to extract, respond with an empty array: []

Example response:
["Always use bullet points for lists", "Keep summaries under 3 sentences"]`;

export class ProceduralMemory implements AgentMemory {
  private provider: AIProvider;
  private model: string;
  private enableTools: boolean;
  private store: FileStore;
  private scope?: Record<string, string>;

  private lastAgentName?: string;

  constructor(config: ProceduralMemoryConfig) {
    this.provider = config.provider;
    this.model = config.model;
    this.enableTools = config.enableTools ?? false;
    this.store = config.store;
    this.scope = config.scope;
  }

  async recall(context: MemoryContext): Promise<RecallResult> {
    const span = context.span?.startSpan("memory.recall", { type: "internal" });

    this.lastAgentName = context.agentName;

    const store = await this.loadStore(context.agentName);
    if (store.instructions.length === 0) {
      span?.info("no stored instructions");
      span?.end();
      return {};
    }

    span?.info("loaded instructions", { count: store.instructions.length });

    const numbered = store.instructions.map((inst, i) => `${i + 1}. ${inst}`).join("\n");

    span?.end();
    return {
      systemSuffix: `## Learned Instructions\n\n${numbered}`,
    };
  }

  async record(context: MemoryContext): Promise<void> {
    if (!context.newMessages || context.newMessages.length === 0) {
      return;
    }

    const span = context.span?.startSpan("memory.record", { type: "internal" });

    const conversationText = this.formatMessages(context.newMessages);
    if (!conversationText.trim()) {
      span?.info("no text content to extract from");
      span?.end();
      return;
    }

    const extractSpan = span?.startSpan("memory.extract", { type: "llm" });
    const result = await generate({
      provider: this.provider,
      model: this.model,
      messages: [{ role: "user", content: conversationText }],
      system: EXTRACTION_SYSTEM,
      span: extractSpan,
    });

    if (!result.ok) {
      span?.warn("extraction failed", { error: result.error });
      span?.end();
      return;
    }

    const text = getTextContent(result.final.content);
    if (!text) {
      span?.end();
      return;
    }

    const newInstructions = this.parseInstructions(text);
    if (newInstructions.length === 0) {
      span?.info("no instructions extracted");
      span?.end();
      return;
    }

    const store = await this.loadStore(context.agentName);
    store.instructions.push(...newInstructions);
    await this.saveStore(context.agentName, store);

    span?.info("saved instructions", { count: newInstructions.length });
    span?.end();
  }

  tools(): ExecutableTool[] {
    if (!this.enableTools) return [];

    const self = this;
    const schema = z.object({
      instruction: z.string().describe("The instruction to remember"),
    });
    const addInstruction: ExecutableTool<typeof schema> = {
      name: "add_instruction",
      description:
        "Save a learned instruction for future runs. Use this when the user explicitly asks you to remember something.",
      schema,
      async execute(input) {
        if (!self.lastAgentName) {
          return "Error: memory not initialized (no recall has been called yet)";
        }
        const store = await self.loadStore(self.lastAgentName);
        store.instructions.push(input.instruction);
        await self.saveStore(self.lastAgentName, store);
        return `Instruction saved: "${input.instruction}"`;
      },
    };

    return [addInstruction];
  }

  private formatMessages(messages: AxleMessage[]): string {
    const parts: string[] = [];
    for (const msg of messages) {
      if (msg.role === "user") {
        const text = typeof msg.content === "string" ? msg.content : getTextContent(msg.content);
        if (text) parts.push(`User: ${text}`);
      } else if (msg.role === "assistant") {
        const text = getTextContent(msg.content);
        if (text) parts.push(`Assistant: ${text}`);
      }
    }
    return parts.join("\n\n");
  }

  private parseInstructions(text: string): string[] {
    let cleaned = text.trim();

    // Strip markdown code fences
    const fenceMatch = cleaned.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```$/);
    if (fenceMatch) {
      cleaned = fenceMatch[1].trim();
    }

    try {
      const parsed = JSON.parse(cleaned);
      if (Array.isArray(parsed) && parsed.every((item) => typeof item === "string")) {
        return parsed;
      }
    } catch {
      // Fall through
    }

    return [];
  }

  private getStorePath(name?: string, scope?: Record<string, string>): string {
    const effectiveName = name ?? "default";
    let filename = effectiveName;

    if (scope && Object.keys(scope).length > 0) {
      const sorted = Object.entries(scope).sort(([a], [b]) => a.localeCompare(b));
      const scopeStr = sorted.map(([k, v]) => `${k}=${v}`).join("&");
      const hash = node_crypto.createHash("sha256").update(scopeStr).digest("hex").slice(0, 8);
      filename = `${effectiveName}-${hash}`;
    }

    return `memory/procedural/${filename}.json`;
  }

  private async loadStore(agentName?: string): Promise<MemoryStore> {
    const path = this.getStorePath(agentName, this.scope);
    const data = await this.store.read(path);
    if (data) {
      try {
        const parsed = JSON.parse(data);
        if (parsed && Array.isArray(parsed.instructions)) {
          return { instructions: parsed.instructions };
        }
      } catch {
        // Invalid JSON
      }
    }
    return { instructions: [] };
  }

  private async saveStore(agentName?: string, store?: MemoryStore): Promise<void> {
    if (!store) return;
    const path = this.getStorePath(agentName, this.scope);
    await this.store.write(path, JSON.stringify(store, null, 2));
  }
}

function getTextContent(content: string | ContentPart[]): string {
  if (typeof content === "string") return content;
  return content
    .filter((part) => part.type === "text" || part.type === "thinking")
    .map((part) => part.text)
    .join("");
}
