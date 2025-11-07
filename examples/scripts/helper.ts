import { Command, Option } from "commander";
import { Axle } from "../../src/index.js";

const PROVIDERS = ["openai", "anthropic", "ollama", "googleai"] as const;
const INSTRUCT_TYPES = ["instruct", "cot"] as const;

interface CommandOptions {
  provider: (typeof PROVIDERS)[number];
  model?: string;
  type: (typeof INSTRUCT_TYPES)[number];
}

const program = new Command();
program
  .addOption(
    new Option("-p, --provider <provider>", "LLM provider to use")
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
  let axle: Axle;
  switch (options.provider) {
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

    case "googleai": {
      if (!process.env.GOOGLE_AI_API_KEY) {
        console.error("GOOGLE_AI_API_KEY not found. Check your .env file");
        process.exit(1);
      }
      axle = new Axle({
        googleai: {
          "api-key": process.env.GOOGLE_AI_API_KEY,
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
        ollama: { model: options.model ?? "gemma3" },
      });
    }
  }
  console.log(`Using ${axle.provider.name} with model ${axle.provider.model}`);
  return axle;
}

export function getOptions(): CommandOptions {
  return options;
}
