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

const PROVIDERS = ["openai", "anthropic", "ollama", "gemini"] as const;
type ProviderNames = (typeof PROVIDERS)[number];
const INSTRUCT_TYPES = ["instruct", "cot"] as const;

interface CommandOptions {
  provider: ProviderNames | Array<ProviderNames>;
  model?: string;
  type: (typeof INSTRUCT_TYPES)[number];
}

const program = new Command();
program
  .addOption(
    new Option("-p, --provider <provider...>", "LLM provider to use")
      .choices(PROVIDERS)
      .default("ollama"),
  )
  .option("-m, --model <model>", "LLM model to use")
  .option("-u, --url <url>", "URL for the provider if necessary")
  .addOption(
    new Option("-t, --type <type>", "Instruct subclass to use")
      .choices(INSTRUCT_TYPES)
      .default("instruct"),
  )
  .parse(process.argv);
const options = program.opts() as CommandOptions;

/**
 * The helper for scripts to parse command line options and get a model
 * @returns
 */
export function useCLIHelper(): [AIProvider, string] {
  const providerOptions = getProviderOption();
  const firstProviderOption = providerOptions[0];
  const provider = getProvider(firstProviderOption);
  const model = options.model ?? getModel(firstProviderOption);
  console.log(`[Helper] Using ${provider.name} with model ${model}`);
  return [provider, model];
}

/**
 *
 * @returns Every provider the library supports with the "default" model
 */
export function useAllProviders(): Array<[AIProvider, string]> {
  const providers: Array<[AIProvider, string]> = [];
  for (const provider of PROVIDERS) {
    providers.push([getProvider(provider), getModel(provider)]);
  }
  return providers;
}

function getProvider(provider: ProviderNames): AIProvider {
  switch (provider) {
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

    case "ollama":
    default: {
      return chatCompletions("http://localhost:11434/v1");
    }
  }
}

function getModel(provider: ProviderNames) {
  switch (provider) {
    case "openai":
      return OpenAI.DefaultModel;
    case "gemini":
      return Gemini.DefaultModel;
    case "anthropic":
      return Anthropic.DefaultModel;
    case "ollama":
      return "gemma3:12b";
  }
}

function getProviderOption(): ProviderNames[] {
  if (Array.isArray(options.provider)) {
    return options.provider;
  } else {
    return [options.provider];
  }
}
