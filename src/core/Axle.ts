import { AxleError } from "../errors/index.js";
import { getProvider } from "../providers/index.js";
import { AIProvider, AIProviderConfig } from "../providers/types.js";
import { Tracer } from "../tracer/tracer.js";
import type { TraceWriter } from "../tracer/types.js";
import { Base64FileInfo, FileInfo, TextFileInfo, loadFileContent } from "../utils/file.js";
import { serialWorkflow } from "../workflows/serial.js";
import { WorkflowResult } from "../workflows/types.js";
import type { Instruct } from "./Instruct.js";

export class Axle {
  provider: AIProvider;
  private stats = { in: 0, out: 0 };
  private variables: Record<string, any> = {};
  tracer = new Tracer();

  constructor(config: Partial<AIProviderConfig>) {
    if (Object.entries(config).length !== 1) {
      throw new AxleError("Must have exactly one config");
    }

    try {
      const provider = Object.keys(config)[0] as keyof AIProviderConfig;
      const providerConfig = config[provider];
      this.provider = getProvider(provider, providerConfig);
    } catch (error) {
      const axleError =
        error instanceof AxleError
          ? error
          : new AxleError("Failed to initialize provider", {
              code: "PROVIDER_INIT_ERROR",
              cause: error instanceof Error ? error : new Error(String(error)),
            });
      throw axleError;
    }
  }

  addWriter(writer: TraceWriter) {
    this.tracer.addWriter(writer);
  }

  /**
   * The execute function takes in a list of Tasks
   * @param steps
   * @returns
   */
  async execute(...steps: Instruct<any>[]): Promise<WorkflowResult> {
    const span = this.tracer.startSpan("execute", { type: "root" });

    try {
      const result = await serialWorkflow(...steps).execute({
        provider: this.provider,
        variables: this.variables,
        stats: this.stats,
        tracer: span,
      });

      span.end();
      return result;
    } catch (error) {
      const axleError =
        error instanceof AxleError
          ? error
          : new AxleError("Execution failed", {
              cause: error instanceof Error ? error : new Error(String(error)),
            });
      span.error(axleError.message);
      span.end("error");
      return { response: null, error: axleError, success: false };
    }
  }

  /**
   * Load a file with the specified encoding or auto-detect based on file extension
   * @param filePath - Path to the file
   * @param encoding - How to load the file: "utf-8" for text, "base64" for binary, or omit for auto-detection
   * @returns FileInfo object with appropriate content based on encoding
   */
  static async loadFileContent(filePath: string): Promise<FileInfo>;
  static async loadFileContent(filePath: string, encoding: "utf-8"): Promise<TextFileInfo>;
  static async loadFileContent(filePath: string, encoding: "base64"): Promise<Base64FileInfo>;
  static async loadFileContent(filePath: string, encoding?: "utf-8" | "base64"): Promise<FileInfo> {
    if (encoding === "utf-8") {
      return loadFileContent(filePath, "utf-8");
    } else if (encoding === "base64") {
      return loadFileContent(filePath, "base64");
    } else {
      return loadFileContent(filePath);
    }
  }
}
