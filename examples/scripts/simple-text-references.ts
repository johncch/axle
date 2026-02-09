#!/usr/bin/env node

import { config } from "dotenv";
import { Axle, Instruct } from "../../dist/index.js";
import { useCLIHelper } from "./helper.js";
config();

async function main() {
  try {
    // Load text files using auto-detection (no encoding parameter needed!)
    const paperFile = await Axle.loadFileContent("./examples/data/research_paper.md");
    const notesFile = await Axle.loadFileContent("./examples/data/meeting_notes.md");

    console.log("✅ Loaded text files successfully using auto-detection");
    console.log(`📊 Paper file: ${paperFile.size} bytes, type: ${paperFile.mimeType}`);
    console.log(`📊 Notes file: ${notesFile.size} bytes, type: ${notesFile.mimeType}`);

    const axle = useCLIHelper();

    // Create instruction with text references
    const instruct = Instruct.with(
      "Based on the provided documents, create a comprehensive summary that identifies the main ethical concerns about AI and suggests concrete action items for addressing them.",
      {
        summary: "string",
        concerns: "string[]",
        actionItems: "string[]",
      },
    );

    instruct.addReference(paperFile, { name: "Research Paper" });
    instruct.addReference(notesFile, { name: "Team Meeting Notes" });

    // Compile the prompt to see how it looks
    const compiled = instruct.compile({});

    console.log("\n🔍 Generated Prompt:");
    console.log("=".repeat(50));
    console.log(compiled.message);
    console.log("\n📋 Instructions:");
    console.log("=".repeat(50));
    console.log(compiled.instructions);

    const result = await axle.execute(instruct);
    console.log("🎯 AI Response:", result.response);
  } catch (error) {
    console.error("❌ Error:", error.message);
  }

  console.log("\n✨ Example completed! This demonstrates:");
  console.log("  • Auto-detection: loadFileContent(path) - no encoding needed!");
  console.log("  • Manual control: loadFileContent(path, encoding) still works");

  console.log("  • Type safety and extension validation for each file type");
  console.log("  • How text references are integrated into prompts");
}

main().catch(console.error);
