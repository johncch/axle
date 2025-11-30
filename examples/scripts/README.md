# Axle Examples

This directory contains example scripts demonstrating various features of Axle.

## Getting Started

1. Install dependencies:
   ```bash
   npm install
   ```

2. Set up your API keys in a `.env` file:
   ```bash
   OPENAI_API_KEY=your_openai_key_here
   ANTHROPIC_API_KEY=your_anthropic_key_here
   ```

3. Run any example:
   ```bash
   npm start examples/scripts/simple-greeting.ts
   ```

## Core Concepts

### Instruct
LLM-callable steps that send prompts and receive structured responses.

### Action
Workflow-callable steps executed between LLM calls (e.g., `WriteToDisk`).

### WorkflowStep
Union type: `Instruct | Action` - the building blocks of workflows.

## Text Examples

### `simple-greeting.ts`
Basic text instruction with variable substitution and file output.
- Shows how to create instructions with structured output
- Demonstrates variable interpolation with `{{name}}`
- Uses `WriteToDisk` action to save results

### `simple-dag.ts`
Demonstrates directed acyclic graph (DAG) workflows.
- Shows how to chain multiple steps (Instruct + Action)
- Illustrates dependencies between nodes using `dependsOn`
- Uses `step` property for node definitions

### `dag-patterns.ts`
Advanced DAG patterns and configurations.
- Complex workflow examples with fan-in/fan-out
- Multiple steps per node (Instruct followed by WriteToDisk)
- Error handling and concurrency control

### `research-dag.ts`
Research-oriented workflow example.
- Multi-step research process with parallel analyzers
- Data synthesis from multiple sources
- Report generation with WriteToDisk action

## Multimodal Examples

### `simple-image.ts`
Basic image analysis with a single image.
- Loads and analyzes one image file
- Simple structured output
- Perfect starting point for vision tasks

**Supported Providers:**
- OpenAI GPT-4o, GPT-4 Turbo, GPT-4 Vision
- Anthropic Claude 3.5/3.7 models
- Google Gemini 2.5 models

**Example Usage:**
```bash
npm start examples/scripts/simple-image.ts
```

### `image-analysis.ts`
Comprehensive image analysis with detailed output.
- Advanced image description
- Structured analysis results
- Multiple output fields (description, elements, message)

### `multimodal-comparison.ts`
Compare multiple images in a single instruction.
- Loads and compares two images
- Identifies similarities and differences
- Provides interpretation and insights

## File Support

### Supported Image Formats
- **JPEG** (`.jpg`, `.jpeg`)
- **PNG** (`.png`)
- **GIF** (`.gif`)
- **WebP** (`.webp`)
- **BMP** (`.bmp`)
- **TIFF** (`.tiff`)

### Supported Document Formats
- **PDF** (`.pdf`) - Anthropic Claude only

### File Size Limits
- Maximum file size: 20MB
- Files are automatically encoded to base64

## Provider Capabilities

| Provider | Images | PDFs | Models |
|----------|--------|------|---------|
| **OpenAI** | ✅ | ❌ | gpt-4o, gpt-4-turbo, gpt-4-vision-preview |
| **Anthropic** | ✅ | ✅ | claude-3-5-haiku-latest, claude-3-7-sonnet-latest |
| **Google** | ✅ | ❌ | gemini-2.5-pro-preview, gemini-2.5-flash-preview |
| **Ollama** | ✅ | ❌ | llava, llama3.2-vision (model-dependent) |

## Sample Data

The `examples/data/` directory contains sample images:
- `economist-brainy-imports.png` (1100×1200, 6KB)
- `economist-raising-arms.png` (1400×1046, 7KB)

## Common Patterns

### Loading Files
```typescript
// Load an image
const imageFile = await Axle.loadFileContent("./path/to/image.jpg");

// Load a PDF (Anthropic only)
const pdfFile = await Axle.loadFileContent("./path/to/document.pdf");

// Load text file
const textFile = await Axle.loadFileContent("./path/to/file.txt", "utf-8");
```

### Adding Files to Instructions
```typescript
const instruction = Instruct.with("Analyze this content");

// For images specifically
instruction.addImage(imageFile);

// For any file type
instruction.addFile(anyFile);

// Multiple files
instruction.addImage(image1);
instruction.addImage(image2);
instruction.addFile(document);
```

### Using Actions (WriteToDisk)
```typescript
import { Instruct, WriteToDisk } from "@anthropic/axle";

// Create an instruction
const instruct = Instruct.with("Generate a greeting for {name}");

// Create an action to write output (uses {} placeholder style)
const writeAction = new WriteToDisk("./output/{name}.txt", "{response}");

// Execute as a workflow
const result = await axle.execute(instruct, writeAction);
```

### DAG Node Definitions
```typescript
// Simple node (just an Instruct)
const dag = {
  step1: Instruct.with("Do something"),
  
  // Node with dependency
  step2: {
    step: Instruct.with("Use {{step1}}"),
    dependsOn: "step1",
  },
  
  // Node with multiple steps (Instruct + Action)
  step3: {
    step: [
      Instruct.with("Generate content", { response: "string" }),
      new WriteToDisk("./output/result.txt", "{response}"),
    ],
    dependsOn: "step2",
  },
};
```

### Provider Configuration
```typescript
// OpenAI with vision model
const axle = new Axle({ 
  openai: { 
    "api-key": process.env.OPENAI_API_KEY,
    model: "gpt-4o" 
  } 
});

// Anthropic with multimodal model
const axle = new Axle({ 
  anthropic: { 
    "api-key": process.env.ANTHROPIC_API_KEY,
    model: "claude-3-5-haiku-latest" 
  } 
});
```

## Error Handling

### File Loading Errors
```typescript
try {
  const file = await Axle.loadFile("./image.jpg");
} catch (error) {
  // Handle: file not found, too large, unsupported format
  console.error("File loading failed:", error.message);
}
```

### Model Compatibility Errors
```typescript
// This will throw an error if the model doesn't support vision
const axle = new Axle({ openai: { "api-key": "...", model: "gpt-3.5-turbo" } });
instruction.addImage(imageFile);
await axle.execute(instruction); // Error: Model doesn't support multimodal
```

## Best Practices

1. **Choose the Right Provider**: Use Anthropic for PDFs, any provider for images
2. **Optimize File Sizes**: Keep images under 20MB for best performance
3. **Clear Instructions**: Be specific about what you want the AI to analyze
4. **Structured Output**: Use typed output formats for consistent results
5. **Error Handling**: Always wrap file operations in try-catch blocks
6. **API Key Security**: Never commit API keys to version control

## Troubleshooting

**"Model does not support multimodal content"**
- Switch to a vision-capable model (see Provider Capabilities table above)

**"File not found"**
- Check file paths are relative to the script location
- Ensure the file exists and has proper permissions

**"File too large"**
- Resize images to under 20MB
- Use image compression tools if needed

**"Unsupported file type"**
- Check the supported formats list above
- Convert files to supported formats if needed