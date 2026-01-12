import { Command, Option } from "commander";
import dotenv from "dotenv";
import { Axle } from "../../src/index.js";
dotenv.config();

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
  .addOption(
    new Option("-t, --type <type>", "Instruct subclass to use")
      .choices(INSTRUCT_TYPES)
      .default("instruct"),
  )
  .parse(process.argv);
const options = program.opts() as CommandOptions;

export function getAxle(): Axle {
  const providers = getProviderOption();
  const provider = providers[0];
  const axle = getProvider(provider);
  console.log(`Using ${axle.provider.name} with model ${axle.provider.model}`);
  return axle;
}

export function getAxles(): Array<Axle> {
  const axles = [];
  const providers = getProviderOption();
  for (const provider of providers) {
    axles.push(getProvider(provider));
  }
  return axles;
}

/**
 *
 * @returns Every provider the library supports with the "default" model
 */
export function getAllAxles(): Array<Axle> {
  const axles = [];
  for (const provider of PROVIDERS) {
    axles.push(getProvider(provider));
  }
  return axles;
}

function getProvider(provider: ProviderNames): Axle {
  let axle: Axle;
  switch (provider) {
    case "openai": {
      if (!process.env.OPENAI_API_KEY) {
        console.error("OPENAI_API_KEY not found. Check your .env file");
        process.exit(1);
      }
      axle = new Axle({
        openai: {
          "api-key": process.env.OPENAI_API_KEY,
          model: options.model,
        },
      });
      break;
    }

    case "gemini": {
      if (!process.env.GEMINI_API_KEY) {
        console.error("GEMINI_API_KEY not found. Check your .env file");
        process.exit(1);
      }
      axle = new Axle({
        gemini: {
          "api-key": process.env.GEMINI_API_KEY,
          model: options.model,
        },
      });
      break;
    }

    case "anthropic": {
      if (!process.env.ANTHROPIC_API_KEY) {
        console.error("ANTHROPIC_API_KEY not found. Check your .env file");
        process.exit(1);
      }
      axle = new Axle({
        anthropic: {
          "api-key": process.env.ANTHROPIC_API_KEY,
          model: options.model,
        },
      });
      break;
    }

    case "ollama":
    default: {
      axle = new Axle({
        ollama: { model: options.model ?? "gpt-oss:20b" },
      });
    }
  }
  return axle;
}

function getProviderOption(): ProviderNames[] {
  if (Array.isArray(options.provider)) {
    return options.provider;
  } else {
    return [options.provider];
  }
}

export function getOptions(): CommandOptions {
  return options;
}
