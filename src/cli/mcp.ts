import { MCP } from "../mcp/index.js";
import type { TracingContext } from "../tracer/types.js";
import type { MCPConfigUse } from "./configs/schemas.js";

export async function connectMcps(
  configs: MCPConfigUse[],
  tracer: TracingContext,
): Promise<MCP[]> {
  const instances: MCP[] = [];
  for (const config of configs) {
    const mcp = new MCP(config);
    await mcp.connect({ tracer });
    instances.push(mcp);
  }
  return instances;
}

export async function closeMcps(instances: MCP[], tracer: TracingContext): Promise<void> {
  for (const mcp of instances) {
    try {
      await mcp.close({ tracer });
    } catch {
      // swallow individual close errors
    }
  }
}
