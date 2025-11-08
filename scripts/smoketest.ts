#!/usr/bin/env tsx

import chalk from "chalk";
import dotenv from "dotenv";
import { Axle, Instruct } from "../src/index.js";

dotenv.config();

interface SmokeTestResult {
  provider: string;
  success: boolean;
  error?: string;
  axleResponse?: string;
  instructResponse?: string;
  model?: string;
  executionTime?: number;
}

interface ProviderConfig {
  name: string;
  config: any;
  envKey?: string;
  displayName: string;
}

async function runSmokeTest(providerConfig: ProviderConfig): Promise<SmokeTestResult> {
  const { name, config, envKey, displayName } = providerConfig;
  console.log(`🧪 Testing ${chalk.cyan(displayName)}...`);

  const startTime = Date.now();

  try {
    // Check for required API key if needed
    if (envKey && !process.env[envKey]) {
      return {
        provider: displayName,
        success: false,
        error: `API key ${envKey} not found in .env file`,
      };
    }

    // Create Axle instance with provider config
    const axle = new Axle(config);

    // Test 1: Simple Axle.execute with Instruct (like simplegreeting)
    console.log(`  → Testing Axle.execute with Instruct...`);
    const greetingInstruct = Instruct.with(
      "You are a friendly assistant. Please provide a warm greeting for someone named Alex. Keep it brief and friendly.",
      { greeting: "string" },
    );

    const axleResult = await axle.execute(greetingInstruct);

    if (!axleResult.success) {
      return {
        provider: displayName,
        success: false,
        error: `Axle.execute failed: ${axleResult.error?.message || "Unknown error"}`,
        executionTime: Date.now() - startTime,
      };
    }

    // Test 2: Direct Instruct call
    console.log(`  → Testing direct Instruct call...`);
    const directInstruct = Instruct.with(
      "Please respond with a simple confirmation message that the system is working.",
      { status: "string", message: "string" },
    );

    const instructResult = await axle.execute(directInstruct);

    if (!instructResult.success) {
      return {
        provider: displayName,
        success: false,
        error: `Direct Instruct failed: ${instructResult.error?.message || "Unknown error"}`,
        executionTime: Date.now() - startTime,
      };
    }

    const executionTime = Date.now() - startTime;

    return {
      provider: displayName,
      success: true,
      axleResponse: (greetingInstruct.result as any)?.greeting || greetingInstruct.rawResponse,
      instructResponse: (directInstruct.result as any)?.status || directInstruct.rawResponse,
      model: axle.provider.model,
      executionTime,
    };
  } catch (error) {
    const executionTime = Date.now() - startTime;
    return {
      provider: displayName,
      success: false,
      error: error instanceof Error ? error.message : String(error),
      executionTime,
    };
  }
}

async function main() {
  console.log(chalk.bold("🔬 Axle Smoke Test"));
  console.log("==================");
  console.log("Testing Axle.execute and Instruct against all providers\n");

  // Define provider configurations
  const providers: ProviderConfig[] = [
    {
      name: "anthropic",
      displayName: "Anthropic (Claude)",
      envKey: "ANTHROPIC_API_KEY",
      config: {
        anthropic: {
          "api-key": process.env.ANTHROPIC_API_KEY || "",
          model: "claude-3-haiku-20240307",
        },
      },
    },
    {
      name: "openai",
      displayName: "OpenAI (GPT)",
      envKey: "OPENAI_API_KEY",
      config: {
        openai: {
          "api-key": process.env.OPENAI_API_KEY || "",
          model: "gpt-4o-mini",
        },
      },
    },
    {
      name: "gemini",
      displayName: "Google AI (Gemini)",
      envKey: "GEMINI_API_KEY",
      config: {
        gemini: {
          "api-key": process.env.GEMINI_API_KEY || "",
          model: "gemini-1.5-flash",
        },
      },
    },
    {
      name: "ollama",
      displayName: "Ollama (Local)",
      config: {
        ollama: {
          url: "http://localhost:11434",
          model: "gemma3",
        },
      },
    },
  ];

  const results: SmokeTestResult[] = [];

  // Test each provider
  for (const providerConfig of providers) {
    const result = await runSmokeTest(providerConfig);
    results.push(result);

    if (result.success) {
      console.log(`${chalk.green("✅")} ${chalk.cyan(result.provider)} - All tests passed`);
      console.log(`   Model: ${result.model}`);
      console.log(`   Time: ${result.executionTime}ms`);
      console.log(
        `   Axle Response: "${result.axleResponse?.substring(0, 60)}${result.axleResponse && result.axleResponse.length > 60 ? "..." : ""}"`,
      );
      console.log(
        `   Instruct Response: "${result.instructResponse?.substring(0, 60)}${result.instructResponse && result.instructResponse.length > 60 ? "..." : ""}"`,
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
  console.log(chalk.bold("📊 Smoke Test Summary"));
  console.log("=====================");

  const successful = results.filter((r) => r.success);
  const failed = results.filter((r) => !r.success);

  console.log(`${chalk.green("✅")} Passed: ${successful.length}`);
  console.log(`${chalk.red("❌")} Failed: ${failed.length}`);
  console.log(`${chalk.blue("🔧")} Total: ${results.length}`);

  if (successful.length > 0) {
    console.log(
      `\n${chalk.green("✅ Working providers:")} ${successful.map((r) => r.provider).join(", ")}`,
    );
  }

  if (failed.length > 0) {
    console.log(
      `\n${chalk.red("❌ Failed providers:")} ${failed.map((r) => r.provider).join(", ")}`,
    );
    console.log(chalk.yellow("\n💡 Setup tips:"));
    console.log("• Create a .env file with your API keys:");
    console.log("  ANTHROPIC_API_KEY=your_anthropic_key");
    console.log("  OPENAI_API_KEY=your_openai_key");
    console.log("  GEMINI_API_KEY=your_google_key");
    console.log("• For Ollama:");
    console.log("  - Start the service: ollama serve");
    console.log("  - Install model: ollama pull llama3.2");
    console.log("  - Ensure port 11434 is accessible");
  }

  const totalTime = results.reduce((sum, r) => sum + (r.executionTime || 0), 0);
  console.log(`\n⏱️  Total execution time: ${totalTime}ms`);

  // Exit with error code if any tests failed
  if (failed.length > 0) {
    console.log(chalk.red("\n💥 Some providers failed the smoke test!"));
    process.exit(1);
  } else {
    console.log(chalk.green("\n🎉 All providers passed the smoke test!"));
  }
}

// Run the script
main().catch((error) => {
  console.error(chalk.red("💥 Unexpected error during smoke test:"));
  console.error(error);
  process.exit(1);
});
