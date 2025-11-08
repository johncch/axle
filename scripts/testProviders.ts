#!/usr/bin/env tsx

import chalk from "chalk";
import dotenv from "dotenv";
import { Axle, Instruct } from "../src/index.js";

dotenv.config();

const TEST_MESSAGE = "Hello! Please respond with a brief greeting. Keep it under 20 words.";

interface TestResult {
  provider: string;
  success: boolean;
  error?: string;
  response?: string;
  model?: string;
  executionTime?: number;
}

interface ProviderConfig {
  name: string;
  config: any;
  envKey?: string;
}

async function testProvider(providerConfig: ProviderConfig): Promise<TestResult> {
  const { name, config, envKey } = providerConfig;
  console.log(`Testing ${chalk.cyan(name)}...`);

  const startTime = Date.now();

  try {
    // Check for required API key if needed
    if (envKey && !process.env[envKey]) {
      return {
        provider: name,
        success: false,
        error: `API key ${envKey} not found in .env file`,
      };
    }

    // Create Axle instance with provider config
    const axle = new Axle(config);

    // Create a simple instruction
    const instruct = Instruct.with(TEST_MESSAGE, { response: "string" });

    // Execute the instruction
    const result = await axle.execute(instruct);
    const executionTime = Date.now() - startTime;

    if (result.success) {
      return {
        provider: name,
        success: true,
        response: (instruct.result as any)?.response || instruct.rawResponse,
        model: config[name]?.model || "default",
        executionTime,
      };
    } else {
      return {
        provider: name,
        success: false,
        error: result.error?.message || "Unknown error",
        executionTime,
      };
    }
  } catch (error) {
    const executionTime = Date.now() - startTime;
    return {
      provider: name,
      success: false,
      error: error instanceof Error ? error.message : String(error),
      executionTime,
    };
  }
}

async function main() {
  console.log(chalk.bold("🧪 Testing AI Provider Integrations"));
  console.log("=====================================\n");

  // Define provider configurations
  const providers: ProviderConfig[] = [
    {
      name: "anthropic",
      envKey: "ANTHROPIC_API_KEY",
      config: {
        anthropic: {
          "api-key": process.env.ANTHROPIC_API_KEY || "",
        },
      },
    },
    {
      name: "openai",
      envKey: "OPENAI_API_KEY",
      config: {
        openai: {
          "api-key": process.env.OPENAI_API_KEY || "",
        },
      },
    },
    {
      name: "google",
      envKey: "GEMINI_API_KEY",
      config: {
        gemini: {
          "api-key": process.env.GEMINI_API_KEY || "",
        },
      },
    },
    {
      name: "ollama",
      config: {
        ollama: {
          url: "http://localhost:11434",
          model: "gemma3",
        },
      },
    },
  ];

  const results: TestResult[] = [];

  // Test each provider
  for (const providerConfig of providers) {
    const result = await testProvider(providerConfig);
    results.push(result);

    if (result.success) {
      console.log(`${chalk.green("✅")} ${chalk.cyan(result.provider)} - Success`);
      console.log(`   Model: ${result.model}`);
      console.log(`   Time: ${result.executionTime}ms`);
      console.log(
        `   Response: "${result.response?.substring(0, 80)}${result.response && result.response.length > 80 ? "..." : ""}"`,
      );
    } else {
      console.log(`${chalk.red("❌")} ${chalk.cyan(result.provider)} - Failed`);
      console.log(`   Error: ${result.error}`);
      if (result.executionTime) {
        console.log(`   Time: ${result.executionTime}ms`);
      }
    }
    console.log();
  }

  // Summary
  console.log(chalk.bold("📊 Test Summary"));
  console.log("================");

  const successful = results.filter((r) => r.success);
  const failed = results.filter((r) => !r.success);

  console.log(`${chalk.green("✅")} Successful: ${successful.length}`);
  console.log(`${chalk.red("❌")} Failed: ${failed.length}`);
  console.log(`${chalk.blue("🔧")} Total tested: ${results.length}`);

  if (successful.length > 0) {
    console.log(
      `\n${chalk.green("Working providers:")} ${successful.map((r) => r.provider).join(", ")}`,
    );
  }

  if (failed.length > 0) {
    console.log(`\n${chalk.red("Failed providers:")} ${failed.map((r) => r.provider).join(", ")}`);
    console.log(chalk.yellow("\n💡 Tips for common issues:"));
    console.log("• Add API keys to your .env file:");
    console.log("  - ANTHROPIC_API_KEY=your_key_here");
    console.log("  - OPENAI_API_KEY=your_key_here");
    console.log("  - GEMINI_API_KEY=your_key_here");
    console.log("• For Ollama: Make sure the service is running (ollama serve)");
    console.log("• For Ollama: Ensure you have models installed (ollama pull llama3.2)");
    console.log("• Check your internet connection for cloud providers");
  }

  // Exit with error code if any tests failed
  if (failed.length > 0) {
    process.exit(1);
  }
}

// Run the script
main().catch((error) => {
  console.error(chalk.red("💥 Unexpected error:"));
  console.error(error);
  process.exit(1);
});
