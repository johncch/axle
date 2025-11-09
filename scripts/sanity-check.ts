import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

interface TestCase {
  name: string;
  command: string;
}

const jobs: TestCase[] = [
  {
    name: "simple-greeting.job.yml",
    command: "npm start -- -j examples/jobs/simple-greeting.job.yml",
  },
  {
    name: "simple-tool-use.job.yml",
    command: "npm start -- -j examples/jobs/simple-tool-use.job.yml",
  },
  {
    name: "simple-dag.job.yml",
    command: "npm start -- -j examples/jobs/simple-dag.job.yml",
  },
  {
    name: "batch-synthesis.job.yml",
    command: "npm start -- -j examples/jobs/batch-synthesis.job.yml",
  },
];

const scripts: TestCase[] = [
  {
    name: "simple-greeting.ts",
    command: "npx tsx examples/scripts/simple-greeting.ts",
  },
  {
    name: "simple-stream.ts",
    command: "npx tsx examples/scripts/simple-stream.ts",
  },
];

async function runTest(test: TestCase): Promise<{ success: boolean; error?: string }> {
  try {
    const { stdout, stderr } = await execAsync(test.command, {
      timeout: 60000, // 60s timeout
      env: process.env,
    });

    // Check for errors in stderr (some output is normal)
    if (stderr && stderr.toLowerCase().includes("error")) {
      return { success: false, error: stderr };
    }

    return { success: true };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return { success: false, error: errorMsg };
  }
}

async function runSanityCheck() {
  console.log("Running sanity checks...\n");

  let totalPassed = 0;
  let totalFailed = 0;
  const failures: Array<{ name: string; error: string }> = [];

  // Run job files
  console.log("📋 Testing job files:");
  for (const job of jobs) {
    process.stdout.write(`  ${job.name}... `);
    const result = await runTest(job);

    if (result.success) {
      console.log("✓ PASSED");
      totalPassed++;
    } else {
      console.log("✗ FAILED");
      failures.push({ name: job.name, error: result.error || "Unknown error" });
      totalFailed++;
    }
  }

  console.log();

  // Run script files
  console.log("📝 Testing script files:");
  for (const script of scripts) {
    process.stdout.write(`  ${script.name}... `);
    const result = await runTest(script);

    if (result.success) {
      console.log("✓ PASSED");
      totalPassed++;
    } else {
      console.log("✗ FAILED");
      failures.push({ name: script.name, error: result.error || "Unknown error" });
      totalFailed++;
    }
  }

  // Print summary
  console.log("\n" + "=".repeat(60));
  console.log(`Results: ${totalPassed} passed, ${totalFailed} failed`);

  if (failures.length > 0) {
    console.log(`\nFailures:`);
    failures.forEach(({ name, error }) => {
      console.log(`\n  ✗ ${name}:`);
      const errorLines = error.split("\n").slice(0, 3); // Show first 3 lines
      errorLines.forEach((line) => console.log(`    ${line}`));
    });
  } else {
    console.log("\n✅ All sanity checks passed!");
  }

  process.exit(totalFailed > 0 ? 1 : 0);
}

runSanityCheck().catch((error) => {
  console.error("Unexpected error running sanity checks:");
  console.error(error);
  process.exit(1);
});
