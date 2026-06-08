import { MCP, type Span } from "@fifthrevision/axle";
import type { MCPConfigUse } from "./configs/schemas.js";

export async function connectMcps(configs: MCPConfigUse[], span: Span): Promise<MCP[]> {
  const instances: MCP[] = [];
  for (const config of configs) {
    const mcp = new MCP(config);
    await mcp.connect({ span });
    instances.push(mcp);
  }
  return instances;
}

export async function closeMcps(instances: MCP[], span: Span): Promise<void> {
  for (const mcp of instances) {
    try {
      await mcp.close({ span });
    } catch {
      // swallow individual close errors
    }
  }
}
