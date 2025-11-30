import dotenv from "dotenv";
import { Axle, Instruct, WriteToDisk } from "../../src/index.js";
import { ConsoleWriter } from "../../src/recorder/consoleWriter.js";

dotenv.config();
const apiKey = process.env.ANTHROPIC_API_KEY;

if (!apiKey) {
  console.error("Please set ANTHROPIC_API_KEY environment variable");
  process.exit(1);
}

const researchDAG = {
  // Step 1: Research Planning
  researchPlanner: Instruct.with(
    `
    Create a research plan for: {{researchQuestion}}

    Include:
    1. 5 key research angles to investigate
    2. Types of sources to prioritize
    3. Potential biases to watch for
    4. Success criteria for comprehensive coverage

    Structure your response as a detailed research plan.
  `,
    { researchPlanner: "string" },
  ),

  // Step 2: Source Analysis (parallel execution for different source types)
  academicAnalyzer: {
    step: Instruct.with(
      `
      Analyze academic sources related to: {{researchQuestion}}
      Research plan: {{researchPlanner}}

      Focus on research angle: {{researchAngle}}

      Provide:
      - Key findings and statistics
      - Methodology strengths/weaknesses
      - Credibility assessment
      - Relevance to main question
    `,
      { academicAnalyzer: "string" },
    ),
    dependsOn: "researchPlanner",
  },

  industryAnalyzer: {
    step: Instruct.with(
      `
      Analyze industry reports and data for: {{researchQuestion}}
      Research plan: {{researchPlanner}}

      Focus on: {{researchAngle}}

      Extract:
      - Market trends and data
      - Expert opinions
      - Case studies
      - Practical implications
    `,
      { industryAnalyzer: "string" },
    ),
    dependsOn: "researchPlanner",
  },

  // Step 3: Synthesis
  synthesizer: {
    step: Instruct.with(
      `
      Synthesize all research findings:

      Research Question: {{researchQuestion}}
      Academic Analysis: {{academicAnalyzer}}
      Industry Analysis: {{industryAnalyzer}}
      Research Plan: {{researchPlanner}}

      Create:
      1. Executive summary
      2. Key insights with supporting evidence
      3. Conflicting viewpoints analysis
      4. Research gaps identified
      5. Actionable recommendations
    `,
      { synthesizer: "string" },
    ),
    dependsOn: ["academicAnalyzer", "industryAnalyzer"],
  },

  // Step 4: Report Generation
  reportGenerator: {
    step: [
      Instruct.with(
        `
        Generate a comprehensive research report:

        Synthesis: {{synthesizer}}
        Original Question: {{researchQuestion}}

        Structure:
        - Executive Summary
        - Methodology
        - Key Findings
        - Analysis & Discussion
        - Conclusions & Recommendations
        - Areas for Further Research

        Target audience: {{targetAudience}}
        Desired length: {{reportLength}} words

        Format as a well-structured markdown document.
      `,
        { report: "string" },
      ),
      new WriteToDisk("./output/research-report.md", "{{report}}"),
    ],
    dependsOn: "synthesizer",
  },
};

async function runResearchDAG() {
  console.log("🔬 Starting AI Research DAG Workflow...\n");

  const axle = new Axle({ anthropic: { "api-key": apiKey } });
  axle.addWriter(new ConsoleWriter());

  const variables = {
    researchQuestion: "What are the impacts of AI on software development productivity?",
    researchAngle: "Developer experience and workflow optimization",
    targetAudience: "Technical leadership",
    reportLength: "2000",
  };

  console.log("Research Question:", variables.researchQuestion);
  console.log("Research Angle:", variables.researchAngle);
  console.log("Target Audience:", variables.targetAudience);
  console.log("Report Length:", variables.reportLength, "words\n");

  try {
    const result = await axle.executeDAG(researchDAG, variables, {
      maxConcurrency: 2,
      continueOnError: false,
    });

    if (result.success) {
      console.log("✅ DAG execution completed successfully!\n");

      console.log(result);
      console.log("=== Research Results ===");
      console.log(
        "Research Plan:",
        result.response.researchPlanner?.researchPlanner.slice(0, 200) + "...",
      );
      console.log(
        "Academic Analysis:",
        result.response.academicAnalyzer?.academicAnalyzer.slice(0, 200) + "...",
      );
      console.log(
        "Industry Analysis:",
        result.response.industryAnalyzer?.industryAnalyzer.slice(0, 200) + "...",
      );
      console.log("Synthesis:", result.response.synthesizer?.synthesizer.slice(0, 200) + "...");
      console.log(
        "Report Generated:",
        result.response.reportGenerator ? "✅ Saved to ./output/research-report.md" : "❌ Failed",
      );

      console.log("\n=== Execution Logs ===");
      const logs = axle.logs;
      logs.forEach((log) => {
        console.log(`[${log.level}] ${JSON.stringify(log.payload)}`);
      });
    } else {
      console.error("❌ DAG execution failed:", result.error?.message);
    }
  } catch (error) {
    console.error("❌ Error running research DAG:", error);
  }
}

runResearchDAG();
