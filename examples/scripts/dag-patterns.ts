import { Axle, Instruct, WriteToDisk } from "../../src/index.js";

/** UNTESTED */

const apiKey = process.env.ANTHROPIC_API_KEY;

if (!apiKey) {
  console.error("Please set ANTHROPIC_API_KEY environment variable");
  process.exit(1);
}

// Comprehensive DAG demonstrating various patterns
const patternsDAG = {
  // Pattern 1: Simple sequential task
  dataGenerator: Instruct.with(`
    Generate sample data for analysis about: {{topic}}

    Create 5 sample data points with:
    - Numerical values
    - Categories
    - Timestamps

    Format as JSON array.
  `),

  // Pattern 2: Parallel processing (multiple tasks depend on same parent)
  statisticalAnalyzer: {
    step: Instruct.with(`
      Perform statistical analysis on this data: {{dataGenerator}}

      Calculate:
      - Mean, median, mode
      - Standard deviation
      - Distribution analysis
    `),
    dependsOn: "dataGenerator",
  },

  trendAnalyzer: {
    step: Instruct.with(`
      Analyze trends in this data: {{dataGenerator}}

      Identify:
      - Growth patterns
      - Seasonal variations
      - Anomalies
      - Predictions
    `),
    dependsOn: "dataGenerator",
  },

  categoricalAnalyzer: {
    step: Instruct.with(`
      Analyze categorical distribution in: {{dataGenerator}}

      Provide:
      - Category frequencies
      - Cross-tabulations
      - Category insights
    `),
    dependsOn: "dataGenerator",
  },

  // Pattern 3: Fan-in (multiple dependencies)
  comprehensiveReport: {
    step: Instruct.with(`
      Create a comprehensive analysis report using:

      Original Data: {{dataGenerator}}
      Statistical Analysis: {{statisticalAnalyzer}}
      Trend Analysis: {{trendAnalyzer}}
      Categorical Analysis: {{categoricalAnalyzer}}

      Synthesize findings into:
      1. Executive Summary
      2. Key Insights
      3. Data Quality Assessment
      4. Recommendations
    `),
    dependsOn: ["statisticalAnalyzer", "trendAnalyzer", "categoricalAnalyzer"],
  },

  // Pattern 4: Chain continuation
  actionPlan: {
    step: Instruct.with(`
      Based on this comprehensive report: {{comprehensiveReport}}

      Create an action plan with:
      - 3 immediate actions
      - 5 medium-term strategies
      - Success metrics
      - Timeline

      Topic focus: {{topic}}
    `),
    dependsOn: "comprehensiveReport",
  },

  // Pattern 5: Multiple tasks in a node (Instruct + Action)
  outputPackage: {
    step: [
      Instruct.with(
        `
        Package all analysis results for presentation:

        Report: {{comprehensiveReport}}
        Action Plan: {{actionPlan}}
        Original Data: {{dataGenerator}}

        Create a formatted summary for {{audience}}.
        Include visualizations descriptions and key takeaways.
      `,
        { response: "string" },
      ),
      new WriteToDisk("./output/analysis-package.md", "{{response}}"),
    ],
    dependsOn: ["comprehensiveReport", "actionPlan"],
  },

  // Pattern 6: Parallel final tasks
  executiveSummary: {
    step: [
      Instruct.with(
        `
        Create a 1-page executive summary from: {{comprehensiveReport}}

        For audience: {{audience}}
        Focus on business impact and ROI.
      `,
        { response: "string" },
      ),
      new WriteToDisk("./output/executive-summary.md", "{{response}}"),
    ],
    dependsOn: "comprehensiveReport",
  },

  technicalSummary: {
    step: [
      Instruct.with(
        `
        Create a technical summary from: {{comprehensiveReport}}

        Include:
        - Methodology details
        - Statistical significance
        - Technical recommendations
        - Implementation notes
      `,
        { response: "string" },
      ),
      new WriteToDisk("./output/technical-summary.md", "{{response}}"),
    ],
    dependsOn: "comprehensiveReport",
  },
};

// Example with error handling
const errorProneDAG = {
  normalTask: Instruct.with(`Generate a simple greeting for {{name}}`),

  dependentTask: {
    step: Instruct.with(`Elaborate on: {{normalTask}} with more details about {{name}}`),
    dependsOn: "normalTask",
  },
};

async function runPatterns() {
  console.log("🔄 Testing DAG Patterns...\n");

  const axle = new Axle({ anthropic: { "api-key": apiKey } });

  // Test 1: Comprehensive patterns
  console.log("=== Test 1: Comprehensive Analysis DAG ===");
  try {
    const result1 = await axle.executeDAG(
      patternsDAG,
      {
        topic: "e-commerce sales performance",
        audience: "business stakeholders",
      },
      {
        maxConcurrency: 3,
        continueOnError: false,
      },
    );

    if (result1.success) {
      console.log("✅ Comprehensive DAG completed");
      console.log("Generated files:");
      console.log("  - Analysis Package:", result1.response.outputPackage ? "✅" : "❌");
      console.log("  - Executive Summary:", result1.response.executiveSummary ? "✅" : "❌");
      console.log("  - Technical Summary:", result1.response.technicalSummary ? "✅" : "❌");
    } else {
      console.log("❌ Comprehensive DAG failed:", result1.error?.message);
    }
  } catch (error) {
    console.error("Error in comprehensive test:", error);
  }

  console.log("\n=== Test 2: Error Handling ===");
  try {
    const result2 = await axle.executeDAG(
      errorProneDAG,
      {
        name: "World",
      },
      {
        continueOnError: true,
      },
    );

    console.log("Error handling test:", result2.success ? "✅ Success" : "❌ Failed");
    if (!result2.success) {
      console.log("Expected behavior - error was handled");
    }
  } catch (error) {
    console.error("Error in error handling test:", error);
  }

  console.log("\n=== Test 3: Simple Direct Workflow ===");
  try {
    const simpleDAG = {
      step1: Instruct.with("Count to {{number}}"),
      step2: {
        step: Instruct.with("Take this count: {{step1}} and double each number"),
        dependsOn: "step1",
      },
    };

    const result3 = await axle.executeDAG(simpleDAG, {
      number: "5",
    });

    console.log("Direct workflow test:", result3.success ? "✅ Success" : "❌ Failed");
  } catch (error) {
    console.error("Error in direct workflow test:", error);
  }

  console.log("\n=== Test 4: Concurrency Limits ===");
  try {
    const concurrencyDAG = {
      task1: Instruct.with("Generate fact 1 about {{topic}}"),
      task2: Instruct.with("Generate fact 2 about {{topic}}"),
      task3: Instruct.with("Generate fact 3 about {{topic}}"),
      task4: Instruct.with("Generate fact 4 about {{topic}}"),

      summary: {
        step: Instruct.with("Summarize: {{task1}}, {{task2}}, {{task3}}, {{task4}}"),
        dependsOn: ["task1", "task2", "task3", "task4"],
      },
    };

    console.log("Testing with maxConcurrency=1...");
    const start = Date.now();
    const result4 = await axle.executeDAG(
      concurrencyDAG,
      {
        topic: "renewable energy",
      },
      {
        maxConcurrency: 1,
      },
    );
    const duration = Date.now() - start;

    console.log(`Concurrency test completed in ${duration}ms:`, result4.success ? "✅" : "❌");
  } catch (error) {
    console.error("Error in concurrency test:", error);
  }
}

async function demonstrateDAGStructure() {
  console.log("\n🏗️  DAG Structure Analysis\n");

  const { DAGParser } = await import("../../src/workflows/dag.js");

  try {
    const plan = DAGParser.parse(patternsDAG);

    console.log("=== Execution Plan ===");
    console.log(`Total nodes: ${plan.nodes.size}`);
    console.log(`Execution stages: ${plan.stages.length}`);

    plan.stages.forEach((stage, index) => {
      console.log(`Stage ${index + 1}: [${stage.join(", ")}] (${stage.length} parallel tasks)`);
    });

    console.log("\n=== Node Dependencies ===");
    for (const [nodeId, node] of plan.nodes) {
      const deps = node.dependencies.length > 0 ? node.dependencies.join(", ") : "none";
      console.log(`${nodeId}: depends on [${deps}]`);
    }
  } catch (error) {
    console.error("Error analyzing DAG structure:", error);
  }
}

// Run all tests
async function runAllTests() {
  await demonstrateDAGStructure();
  await runPatterns();

  console.log("\n🎉 All DAG pattern tests completed!");
}

runAllTests();
