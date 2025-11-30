import dotenv from "dotenv";
import { Axle, Instruct, WriteToDisk } from "../../src/index.js";
import { ConsoleWriter } from "../../src/recorder/consoleWriter.js";

dotenv.config();
const apiKey = process.env.ANTHROPIC_API_KEY;

if (!apiKey) {
  console.error("Please set ANTHROPIC_API_KEY environment variable");
  process.exit(1);
}

// Simple DAG example demonstrating basic concepts
const simpleDAG = {
  // Step 1: Generate a topic
  topicGenerator: Instruct.with(
    `
    Generate an interesting topic for a blog post about: {{theme}}

    The topic should be:
    - Engaging and clickable
    - Specific and actionable
    - Relevant to the theme

    Return just the topic title.
  `,
    { topicGenerator: "string" },
  ),

  // Step 2: Create outline and content (parallel)
  outlineCreator: {
    step: Instruct.with(
      `
      Create a detailed outline for this blog post topic: {{topicGenerator}}

      Include:
      - Introduction hook
      - 3-5 main sections with subsections
      - Conclusion with call-to-action

      Format as a structured outline.
    `,
      { outlineCreator: "string" },
    ),
    dependsOn: "topicGenerator",
  },

  keywordResearcher: {
    step: Instruct.with(
      `
      Research relevant keywords and SEO terms for this topic: {{topicGenerator}}

      Provide:
      - 5 primary keywords
      - 10 related long-tail keywords
      - Content optimization suggestions
    `,
      { keywordResearcher: "string" },
    ),
    dependsOn: "topicGenerator",
  },

  // Step 3: Write the blog post
  contentWriter: {
    step: Instruct.with(
      `
      Write a complete blog post using:

      Topic: {{topicGenerator}}
      Outline: {{outlineCreator}}
      Keywords: {{keywordResearcher}}

      Requirements:
      - Engaging introduction
      - Well-structured content following the outline
      - Natural keyword integration
      - Strong conclusion
      - Approximately {{wordCount}} words

      Format as clean markdown.
    `,
      { contentWriter: "string" },
    ),
    dependsOn: ["outlineCreator", "keywordResearcher"],
  },

  // Step 4: Save to file
  fileSaver: {
    step: [
      Instruct.with("Format the following content as a final blog post:\n\n{{contentWriter}}", {
        response: "string",
      }),
      new WriteToDisk("./output/blog-post.md", "{{response}}"),
    ],
    dependsOn: "contentWriter",
  },
};

async function runSimpleDAG() {
  console.log("📝 Starting Simple Blog Post DAG...\n");

  const axle = new Axle({ anthropic: { "api-key": apiKey } });
  axle.addWriter(new ConsoleWriter());

  const variables = {
    theme: "sustainable technology",
    wordCount: "800",
  };

  console.log("Theme:", variables.theme);
  console.log("Target Length:", variables.wordCount, "words\n");

  try {
    const result = await axle.executeDAG(simpleDAG, variables, {
      maxConcurrency: 2,
    });

    if (result.success) {
      console.log("✅ Blog post generation completed!\n");

      console.log("Generated Topic:", result.response.topicGenerator);
      console.log("Outline Created:", result.response.outlineCreator ? "✅" : "❌");
      console.log("Keywords Researched:", result.response.keywordResearcher ? "✅" : "❌");
      console.log("Content Written:", result.response.contentWriter ? "✅" : "❌");
      console.log("File Saved:", result.response.fileSaver ? "✅ ./output/blog-post.md" : "❌");
    } else {
      console.error("❌ DAG execution failed:", result.error?.message);
    }
  } catch (error) {
    console.error("❌ Error:", error);
  }
}

runSimpleDAG();
