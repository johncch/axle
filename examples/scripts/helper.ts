import { Command, Option } from "commander";
import dotenv from "dotenv";
import {
  Anthropic,
  anthropic,
  chatCompletions,
  Gemini,
  gemini,
  OpenAI,
  openai,
} from "../../src/index.js";
import { AIProvider } from "../../src/providers/types.js";
dotenv.config();

/**
 * This file contains a bunch of helpers to parse provider and model names.
 */

const CHAT_COMPLETIONS_PRESETS: Record<
  string,
  { url: string; envVar: string; defaultModel: string }
> = {
  ollama: {
    url: "http://localhost:11434/v1",
    envVar: "",
    defaultModel: "qwen3:32b",
  },
  openrouter: {
    url: "https://openrouter.ai/api/v1",
    envVar: "OPENROUTER_API_KEY",
    defaultModel: "deepseek/deepseek-v3.2",
  },
};

const NATIVE_PROVIDERS = ["openai", "anthropic", "gemini"] as const;
const PROVIDERS = [...NATIVE_PROVIDERS, ...Object.keys(CHAT_COMPLETIONS_PRESETS)] as const;
type ProviderName = (typeof PROVIDERS)[number];

interface CommandOptions {
  provider: ProviderName | Array<ProviderName>;
  model?: string;
  url?: string;
}

const program = new Command();
program
  .addOption(
    new Option("-p, --provider <provider...>", "LLM provider to use")
      .choices(PROVIDERS)
      .default("ollama"),
  )
  .option("-m, --model <model>", "LLM model to use")
  .option("-u, --url <url>", "Override base URL for ChatCompletions providers")
  .parse(process.argv);
const options = program.opts() as CommandOptions;

/**
 * The helper for scripts to parse command line options and get a model
 */
export function useCLIHelper(): [AIProvider, string] {
  const providerOptions = getProviderOption();
  const firstProviderOption = providerOptions[0];
  const provider = getProvider(firstProviderOption);
  const model = options.model ?? getDefaultModel(firstProviderOption);
  console.log(`[Helper] Using ${provider.name} with model ${model}`);
  return [provider, model];
}

/**
 * @returns Every provider the library supports with the "default" model
 */
export function useAllProviders(): Array<[AIProvider, string]> {
  const providers: Array<[AIProvider, string]> = [];
  for (const provider of PROVIDERS) {
    providers.push([getProvider(provider), getDefaultModel(provider)]);
  }
  return providers;
}

function getProvider(name: ProviderName): AIProvider {
  switch (name) {
    case "openai": {
      if (!process.env.OPENAI_API_KEY) {
        console.error("OPENAI_API_KEY not found. Check your .env file");
        process.exit(1);
      }
      return openai(process.env.OPENAI_API_KEY);
    }

    case "gemini": {
      if (!process.env.GEMINI_API_KEY) {
        console.error("GEMINI_API_KEY not found. Check your .env file");
        process.exit(1);
      }
      return gemini(process.env.GEMINI_API_KEY);
    }

    case "anthropic": {
      if (!process.env.ANTHROPIC_API_KEY) {
        console.error("ANTHROPIC_API_KEY not found. Check your .env file");
        process.exit(1);
      }
      return anthropic(process.env.ANTHROPIC_API_KEY);
    }

    default: {
      const preset = CHAT_COMPLETIONS_PRESETS[name];
      if (!preset) {
        console.error(`Unknown provider: ${name}`);
        process.exit(1);
      }
      const url = options.url ?? preset.url;
      const key = preset.envVar ? (process.env[preset.envVar] ?? "") : "";
      if (preset.envVar && !key) {
        console.error(`${preset.envVar} not found. Check your .env file`);
        process.exit(1);
      }
      return chatCompletions(url, key);
    }
  }
}

function getDefaultModel(name: ProviderName): string {
  switch (name) {
    case "openai":
      return OpenAI.DefaultModel;
    case "gemini":
      return Gemini.DefaultModel;
    case "anthropic":
      return Anthropic.DefaultModel;
    default: {
      const preset = CHAT_COMPLETIONS_PRESETS[name];
      return preset?.defaultModel ?? "unknown";
    }
  }
}

function getProviderOption(): ProviderName[] {
  if (Array.isArray(options.provider)) {
    return options.provider;
  } else {
    return [options.provider];
  }
}
