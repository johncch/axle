import { argv, exit, setExitCode } from "./runtime.js";

const providers = ["openai", "anthropic", "gemini", "chatcompletions"] as const;
type ProviderName = (typeof providers)[number];

interface Options {
  providers: ProviderName[];
  continueOnError: boolean;
}

const options = parseArgs(argv.slice(2));

const failures: Array<{ provider: ProviderName; code: number | null }> = [];

for (const provider of options.providers) {
  console.log(`\n[cache-telemetry] ${provider}`);
  const code = await runProvider(provider);
  if (code !== 0) {
    failures.push({ provider, code });
    if (!options.continueOnError) break;
  }
}

if (failures.length > 0) {
  console.log("\n[cache-telemetry] failures");
  for (const failure of failures) {
    console.log(`- ${failure.provider}: exit ${failure.code ?? "signal"}`);
  }
  setExitCode(1);
} else {
  console.log("\n[cache-telemetry] all selected checks passed");
}

function runProvider(provider: ProviderName): Promise<number | null> {
  return import(new URL(`./${provider}.ts`, import.meta.url).href).then(
    () => 0,
    (error) => {
      console.error(error);
      return 1;
    },
  );
}

function parseArgs(args: string[]): Options {
  const parsed: Options = {
    providers: [...providers],
    continueOnError: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = () => {
      const value = args[++i];
      if (!value) throw new Error(`Missing value for ${arg}`);
      return value;
    };

    switch (arg) {
      case "--provider":
      case "--providers":
        parsed.providers = splitProviders(next());
        break;
      case "--continue":
        parsed.continueOnError = true;
        break;
      case "--help":
      case "-h":
        printHelp();
        exit(0);
      default:
        if (!arg.startsWith("-")) {
          parsed.providers = splitProviders(arg);
          break;
        }
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return parsed;
}

function splitProviders(value: string): ProviderName[] {
  const selected = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  if (selected.length === 0) throw new Error("At least one provider is required");

  return selected.map((name) => {
    if (!isProvider(name)) {
      throw new Error(`Unknown provider: ${name}. Expected one of: ${providers.join(", ")}`);
    }
    return name;
  });
}

function isProvider(value: string): value is ProviderName {
  return providers.includes(value as ProviderName);
}

function printHelp(): void {
  console.log(`Cache telemetry checks

Usage:
  pnpm exec tsx checks/cache-telemetry/run.ts
  pnpm exec tsx checks/cache-telemetry/run.ts --provider openai,anthropic

Options:
  --provider <ids>  Comma-separated providers: ${providers.join(", ")}.
  --continue        Keep running remaining checks after a failure.
  --help            Show this help.
`);
}
