# Tools and Actions Workflow Refactor

**Date:** 2025-11-30  
**Status:** Completed

## Overview

This document captures the design decisions made during the refactor that separates LLM-callable Tools from workflow-callable Actions and simplifies the workflow API.

## Key Concepts

### Tool vs Action

These are fundamentally different concepts:

| Aspect | Tool | Action |
|--------|------|--------|
| **Called by** | LLM (during generation) | Workflow orchestrator (between steps) |
| **Interface** | Function-like with Zod input schema | Pipe-like with string input + variables |
| **Returns** | String (or structured object serialized for LLM) | String or void |
| **Purpose** | Give LLM capabilities (search, calculate, etc.) | Perform side effects (write files, etc.) |

### WorkflowStep

A workflow step is the union type:

```typescript
type WorkflowStep = Instruct<any> | Action;
```

- **Instruct**: An LLM-callable step that sends prompts and receives structured responses
- **Action**: A workflow-callable step executed between LLM calls (e.g., `WriteToDisk`)

### The `$previous` Variable

The `$previous` variable is the single source-of-truth for step-to-step data flow:

- Every step produces an `outputs` object which is merged into `variables`
- `$previous` contains the full output object from the last step
- Actions use `$previous` for input derivation:
  - If `$previous.response` exists → `input = String($previous.response)`
  - Otherwise → `input = JSON.stringify($previous)`
- The final workflow result is `variables.$previous`

## Design Decisions

### 1. Remove Global Registries

**Decision:** Remove `src/registry/` and `src/tasks/` directories entirely.

**Rationale:**
- Global registries add complexity without significant benefit
- Runtime instantiation should be explicit
- CLI convenience is better served by factory functions

**What was removed:**
- `src/registry/` directory
- `src/tasks/` directory  
- `Task` interface from `src/types.ts`
- `Keys.LastResult` enum from `src/utils/variables.ts`

### 2. Introduce Factory Functions for CLI

**Decision:** Create `src/cli/factories.ts` with explicit factory functions.

**Rationale:**
- Factories provide CLI convenience without global state
- Makes dependencies explicit and testable
- Easy to extend with new tools/actions

**Factory functions:**
- `createTool(name, config?)` - Create a single tool by name
- `createTools(names, config?)` - Create multiple tools
- `createWriteToDiskAction(path, content?)` - Create a WriteToDisk action
- `availableTools` - List of available tool names

### 3. Simplify Workflow Data Contract

**Decision:** Use `$previous` as the primary mechanism for step-to-step data flow.

**Rationale:**
- Simpler mental model than multiple result variables
- Consistent behavior across step types
- `Keys.LastResult` was redundant

**Implementation:**
- Serial workflow sets `variables.$previous` after each step
- Actions derive input from `$previous.response` or JSON-stringify `$previous`
- Final workflow result is `variables.$previous`

### 4. Placeholder Styles

**Decision:** Standardize on `{{variable}}` for all variable substitution.

| Style | Context | Example |
|-------|---------|---------|
| `{{var}}` | All variable substitution | `Hello {{name}}`, `./output/{{name}}.txt` |
| `*` / `**` | Batch file patterns (glob) | `./output/*.txt` |

**Rationale:**
- `{{}}` avoids conflicts with JSON/code in LLM prompts
- Single style reduces cognitive overhead for users
- Matches industry standards (Handlebars, Mustache, Jinja2, GitHub Actions)
- `*`/`**` are conceptually different (file patterns, not variables)

**See:** `2025-11-30-standardize-placeholder-syntax.md` for full details on this decision.

## Code Changes Summary

### Removed
- `src/tasks/` directory
- `src/registry/` directory
- `src/tools/registry.ts`
- `Task` interface
- `Keys.LastResult` enum
- `implements Task` from `AbstractInstruct`

### Added/Updated
- `src/cli/factories.ts` - Tool and action factory functions
- `src/actions/writeToDisk.ts` - `WriteToDisk` action with documentation
- `src/actions/types.ts` - `Action` and `ActionContext` interfaces
- `src/cli/converters/chat.ts` - Uses `createTools`
- `src/cli/converters/writeToDisk.ts` - Uses `createWriteToDiskAction`
- `src/workflows/serial.ts` - Uses `$previous` for data flow
- `src/utils/replace.ts` - Supports both placeholder styles

### Tests Added
- `tests/actions/writeToDisk.test.ts`
- `tests/cli/factories.test.ts`
- `tests/workflows/serial.test.ts`

## Migration Notes

For downstream users updating to this version:

1. **Replace `Task` with `Action` or `Instruct`** - The `Task` interface no longer exists
2. **Use factories instead of registries** - Import from `src/cli/factories.ts`
3. **Use `$previous` for step results** - `Keys.LastResult` is removed
4. **Update YAML configs** - Use `step` property instead of `task`

## Future Considerations

1. **Additional built-in actions** - Expand `factories.ts` as new actions are added
2. **Integration examples** - Add end-to-end examples showing YAML → CLI → workflow execution