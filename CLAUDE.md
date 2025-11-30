# Build, Test & Lint Commands

**Note:** This project uses `pnpm` for development. All commands below use `pnpm`.

- Build: `pnpm run build` (pkgroll with clean-dist and minify)
- Build (dev): `pnpm run build-dev` (pkgroll with clean-dist, no minify)
- Test all: `pnpm test`
- Test single: `pnpm test -- -t "test name pattern"` or `pnpm test -- path/to/file.test.ts`
- Start: `pnpm start` (runs with tsx)
- Get models: `pnpm run get-models`
- Run prompt scenarios: `pnpm run prompt-scenarios`

# Code Style Guidelines

- **Imports**: ES modules, use node: prefix for Node.js modules
- **Formatting**: 2-space indentation, Prettier with organize-imports plugin
- **Types**: Strong TypeScript typing, explicit function parameters and returns
- **Naming**: 
  - PascalCase for classes and interfaces (e.g., `FilePathInfo`, `Instruct`, `Axle`)
  - camelCase for functions and variables
- **Error Handling**: Use descriptive error messages in try/catch blocks, utilize custom error classes
- **Testing**: Jest with descriptive test names, organize with nested describe blocks

# Repository Structure

- `src/`: Source code
  - `actions/`: Workflow actions (WriteToDisk) - executed between LLM calls
  - `ai/`: LLM provider integrations (Anthropic, OpenAI, Ollama, Gemini)
  - `cli/`: CLI implementation
    - `configs/`: Configuration handling
    - `converters/`: Data format converters
    - `factories.ts`: Tool and action factory functions
  - `core/`: Core functionality (Axle, Instruct, ChainOfThought)
  - `errors/`: Custom error classes
  - `messages/`: Conversation and message handling
  - `recorder/`: Logging and recording functionality
  - `tools/`: LLM-callable tools (Brave, Calculator)
  - `utils/`: Helper functions
  - `workflows/`: Workflow implementations (Serial, Concurrent, DAG)
- `tests/`: Test files (mirrors src/ structure)
  - `actions/`: Action tests
  - `ai/`: AI provider tests
    - `anthropic/`: Anthropic provider tests
    - `gemini/`: Gemini provider tests
    - `ollama/`: Ollama provider tests
    - `openai/`: OpenAI provider tests
  - `cli/`: CLI tests (factories, converters)
  - `core/`: Core functionality tests
  - `messages/`: Message handling tests
  - `recorder/`: Recorder tests
  - `utils/`: Utility function tests
  - `workflows/`: Workflow tests
- `examples/`: Sample job definitions and scripts
- `scripts/`: Utility scripts
- `docs/`: Documentation
  - `development/`: Development decision documents (dated design docs)
- `dist/`: Build output (not checked in)

# Key Concepts

- **Instruct**: LLM-callable steps that send prompts and receive structured responses
- **Action**: Workflow-callable steps executed between LLM calls (e.g., WriteToDisk)
- **WorkflowStep**: Union type `Instruct | Action` - building blocks of workflows
- **Tool**: LLM-callable functions with Zod schemas (e.g., brave, calculator)
- **$previous**: Variable containing the output from the previous workflow step