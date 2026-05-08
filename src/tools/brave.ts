import * as z from "zod";
import { BraveProviderConfig } from "../cli/configs/schemas.js";
import { throwIfAborted, raceWithSignal } from "../utils/abort.js";
import { delay } from "../utils/utils.js";
import type { ExecutableTool, ToolContext } from "./types.js";

const braveSearchSchema = z.object({
  searchTerm: z.string().describe("The search term to query"),
});

class BraveSearchTool implements ExecutableTool<typeof braveSearchSchema> {
  name = "brave";
  description = "Perform a search using the Brave search engine";
  schema = braveSearchSchema;

  apiKey: string | undefined;
  throttle: number | undefined;
  lastExecTime: number = 0;

  constructor(config?: BraveProviderConfig) {
    if (config) {
      this.configure(config);
    }
  }

  configure(config: BraveProviderConfig) {
    const { rateLimit } = config;
    this.apiKey = config["api-key"];
    this.throttle = rateLimit ? 1100 / rateLimit : undefined;
  }

  async execute(params: z.infer<typeof braveSearchSchema>, ctx: ToolContext): Promise<string> {
    const { searchTerm } = params;

    if (this.throttle) {
      while (Date.now() - this.lastExecTime < this.throttle) {
        await raceWithSignal(delay(this.throttle - (Date.now() - this.lastExecTime)), ctx.signal);
      }
      this.lastExecTime = Date.now();
    }

    try {
      throwIfAborted(ctx.signal);
      const apiKey = this.apiKey;
      const endpoint = "https://api.search.brave.com/res/v1/web/search";

      const url = new URL(endpoint);
      url.searchParams.append("q", searchTerm);
      url.searchParams.append("format", "json");

      const response = await fetch(url.toString(), {
        method: "GET",
        signal: ctx.signal,
        headers: {
          Accept: "application/json",
          "X-Subscription-Token": apiKey ?? "",
        },
      });

      if (!response.ok) {
        throw new Error(`[Brave] HTTP error ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      return JSON.stringify(data);
    } catch (error) {
      if (ctx.signal.aborted || (error instanceof Error && error.name === "AbortError")) {
        throw error;
      }
      if (error instanceof Error) {
        throw new Error(`[Brave] Error fetching search results: ${error.message}`);
      }
      throw error;
    }
  }
}

const braveSearchTool = new BraveSearchTool();
export default braveSearchTool;
