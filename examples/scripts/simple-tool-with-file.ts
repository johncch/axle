import { z } from "zod";
import type { ExecutableTool } from "../../src/index.js";
import { Agent, Instruct, loadFileContent } from "../../src/index.js";
import { useCLIHelper } from "./helper.js";

const [provider, model] = useCLIHelper();

const showChartTool: ExecutableTool = {
  name: "show_chart",
  description: "Returns a chart image for the given topic.",
  schema: z.object({ topic: z.string() }),
  async execute() {
    const image = await loadFileContent("./examples/data/economist-brainy-imports.png", "base64");
    return [
      { type: "text", text: "Chart attached." },
      { type: "file", file: image },
    ];
  },
};

async function run() {
  const instruct = new Instruct(
    "Use the show_chart tool with topic 'imports', then describe what the chart shows in one sentence.",
  );

  const agent = new Agent({ provider, model, tools: [showChartTool] });
  const result = await agent.send(instruct).final;

  console.log(result.response);
}

run();
