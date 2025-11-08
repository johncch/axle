# Build, Test & Lint Commands

- Build: `npm run build` (pkgroll with clean-dist and minify)
- Build (dev): `npm run build-dev` (pkgroll with clean-dist, no minify)
- Test all: `npm test`
- Test single: `npm test -- -t "test name pattern"` or `npm test -- path/to/file.test.ts`
- Start: `npm start` (runs with tsx)
- Get models: `npm run get-models`
- Run prompt scenarios: `npm run prompt-scenarios`

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
  - `ai/`: LLM provider integrations (Anthropic, OpenAI, Ollama, Gemini)
  - `cli/`: CLI implementation
    - `configs/`: Configuration handling
    - `converters/`: Data format converters
  - `core/`: Core functionality (Axle, Instruct, ChainOfThought)
  - `errors/`: Custom error classes
  - `recorder/`: Logging and recording functionality
  - `registry/`: Task and node registry
  - `tasks/`: Task implementations
  - `tools/`: External tool integrations (Brave, Calculator)
  - `utils/`: Helper functions
  - `workflows/`: Workflow implementations (Serial, Concurrent)
- `tests/`: Test files (mirrors src/ structure)
  - `ai/`: AI provider tests
    - `anthropic/`: Anthropic provider tests
    - `gemini/`: Gemini provider tests
    - `ollama/`: Ollama provider tests
    - `openai/`: OpenAI provider tests
  - `core/`: Core functionality tests
  - `messages/`: Message handling tests
  - `recorder/`: Recorder tests
  - `utils/`: Utility function tests
- `examples/`: Sample job definitions
- `scripts/`: Utility scripts
- `dist/`: Build output (not checked in)