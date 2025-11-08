import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

interface ModelInfo {
  provider: string;
  models: Array<{
    id: string;
    multimodal?: boolean;
  }>;
  error?: string;
}

async function getAnthropicModels(): Promise<ModelInfo> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { provider: "Anthropic", models: [], error: "Missing ANTHROPIC_API_KEY" };
  }

  try {
    const response = await fetch("https://api.anthropic.com/v1/models", {
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    const models =
      data.data?.map((model: any) => ({
        id: model.id,
        multimodal:
          model.input_modalities?.includes("text") && model.input_modalities?.includes("image"),
      })) || [];
    return { provider: "Anthropic", models };
  } catch (error) {
    return { provider: "Anthropic", models: [], error: error.message };
  }
}

async function getOpenAIModels(): Promise<ModelInfo> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return { provider: "OpenAI", models: [], error: "Missing OPENAI_API_KEY" };
  }

  try {
    const response = await fetch("https://api.openai.com/v1/models", {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    const models =
      data.data
        ?.map((model: any) => ({
          id: model.id,
        }))
        .sort((a, b) => a.id.localeCompare(b.id)) || [];
    return { provider: "OpenAI", models };
  } catch (error) {
    return { provider: "OpenAI", models: [], error: error.message };
  }
}

async function getGeminiModels(): Promise<ModelInfo> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return { provider: "Gemini", models: [], error: "Missing GEMINI_API_KEY" };
  }

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`,
      {
        headers: {
          "Content-Type": "application/json",
        },
      },
    );

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    const models =
      data.models?.map((model: any) => ({
        id: model.name.replace("models/", ""),
        multimodal:
          model.supportedGenerationMethods?.includes("generateContent") &&
          model.inputTokenLimit &&
          model.outputTokenLimit,
      })) || [];
    return { provider: "Gemini", models };
  } catch (error) {
    return { provider: "Gemini", models: [], error: error.message };
  }
}

async function getOllamaModels(): Promise<ModelInfo> {
  const url = process.env.OLLAMA_URL || "http://localhost:11434";

  try {
    const response = await fetch(`${url}/api/tags`, {
      headers: {
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    const models =
      data.models?.map((model: any) => ({
        id: model.name,
        multimodal:
          model.details?.family?.includes("vision") ||
          model.name.includes("vision") ||
          model.name.includes("llava"),
      })) || [];
    return { provider: "Ollama", models };
  } catch (error) {
    return { provider: "Ollama", models: [], error: error.message };
  }
}

async function main() {
  console.log("Fetching models from all providers...\n");

  const providers = [getAnthropicModels(), getOpenAIModels(), getGeminiModels(), getOllamaModels()];

  const results = await Promise.all(providers);

  for (const result of results) {
    console.log(`\n${result.provider}:`);
    if (result.error) {
      console.log(`  Error: ${result.error}`);
    } else if (result.models.length === 0) {
      console.log("  No models found");
    } else {
      console.log(`  Found ${result.models.length} models:`);
      for (const model of result.models) {
        const multimodalIndicator = model.multimodal ? " [multimodal]" : "";
        console.log(`    - ${model.id}${multimodalIndicator}`);
      }
    }
  }

  // Generate TypeScript model definitions file
  await generateModelFile(results);

  console.log("\nDone!");
}

function generateConstName(modelId: string): string {
  return modelId
    .replace(/[^a-zA-Z0-9]/g, "_")
    .replace(/^(\d)/, "_$1")
    .toUpperCase();
}

async function generateProviderFile(provider: ModelInfo, outputDir: string): Promise<void> {
  if (provider.error || provider.models.length === 0) return;

  const providerName = provider.provider.toLowerCase();
  let content = `// Auto-generated ${provider.provider} model definitions\n\n`;

  // Generate Models const
  content += "export const Models = {\n";
  const modelEntries: Array<{ constName: string; modelId: string; multimodal: boolean }> = [];

  for (const model of provider.models) {
    const constName = generateConstName(model.id);
    modelEntries.push({
      constName,
      modelId: model.id,
      multimodal: model.multimodal || false,
    });
    content += `  ${constName}: "${model.id}",\n`;
  }

  content += "} as const;\n\n";

  // Generate MULTIMODAL_MODELS const if any multimodal models exist
  const multimodalModels = modelEntries.filter((m) => m.multimodal);
  if (multimodalModels.length > 0) {
    content += "export const MULTIMODAL_MODELS = [\n";
    for (const model of multimodalModels) {
      content += `  Models.${model.constName},\n`;
    }
    content += "] as const;\n";
  }

  const filePath = join(outputDir, `${providerName}.ts`);
  await writeFile(filePath, content, "utf8");
  console.log(`Generated ${provider.provider} model definitions at: ${filePath}`);
}

async function generateModelFile(results: ModelInfo[]): Promise<void> {
  const outputDir = join(process.cwd(), "output");

  try {
    await mkdir(outputDir, { recursive: true });
  } catch (error) {
    // Directory might already exist
  }

  const commercialProviders = results.filter(
    (r) => r.provider === "Anthropic" || r.provider === "OpenAI" || r.provider === "Gemini",
  );

  for (const provider of commercialProviders) {
    await generateProviderFile(provider, outputDir);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}
