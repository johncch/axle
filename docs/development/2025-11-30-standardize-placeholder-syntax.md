# Standardize Placeholder Syntax

**Date:** 2025-11-30  
**Status:** Completed  
**Branch:** `refactor/standardize-placeholder-syntax`

## Overview

This document captures the decision to standardize on `{{variable}}` (double-brace) placeholder syntax throughout the codebase, replacing the mixed usage of `{variable}` and `{{variable}}` styles.

## Background

Prior to this change, the codebase used different placeholder styles in different contexts:

| Style | Context | Example |
|-------|---------|---------|
| `{{var}}` | LLM prompts, content templates | `Hello {{name}}` |
| `{var}` | File path templates | `./output/{name}.txt` |
| `*` / `**` | Batch file patterns | `./output/*.txt` |

This created cognitive overhead for users who needed to remember which style to use where.

## Decision

**Standardize on `{{variable}}` for all variable substitution.**

The only exception is glob patterns (`*` and `**`) which remain unchanged because they are conceptually different—they represent file pattern matching, not variable substitution.

## Rationale

1. **Reduces cognitive load** — One pattern to remember for all variable substitution
2. **Avoids conflicts** — `{{}}` is unlikely to appear in JSON, code, or natural language
3. **Industry standard** — Matches widely-used templating systems:
   - Handlebars / Mustache
   - Jinja2
   - GitHub Actions (`${{ }}`)
   - Ansible
4. **Globs are different** — `*` and `**` are file patterns, not variables, so keeping them separate is intuitive

## Tradeoff

File paths become slightly more verbose:

```yaml
# Before
output: ./output/greeting-{name}.txt

# After  
output: ./output/greeting-{{name}}.txt
```

The consistency benefit outweighs the 2 extra characters.

## Code Changes

### Source Files Updated

- `src/actions/writeToDisk.ts`
  - Changed path template replacement from `"{}"` to `"{{}}"`
  - Updated all documentation examples
  
- `src/workflows/skipConditions/fileExistSkipCondition.ts`
  - Changed pattern replacement from `"{}"` to `"{{}}"`

- `src/utils/file.ts`
  - Fixed `ensureDirectoryExistence` bug with deeply nested directories
  - Now uses `mkdir` with `{ recursive: true }` instead of manual recursion

### Example YAML Files Updated

- `examples/jobs/simple-greeting.job.yml`
  - `output: ./output/greeting-{{name}}.txt`
  
- `examples/jobs/tool-use.job.yml`
  - `output: ./output/{{name}}.txt`
  
- `examples/jobs/batch-synthesis.job.yml`
  - `output: ./output/results-{{stem}}.txt`
  - `pattern: "./output/results-{{stem}}.txt"` (in skip-if comment)

### Tests Updated

- `tests/actions/writeToDisk.test.ts`
  - Updated path template tests to use `{{}}` style
  - Updated test descriptions
  - Enabled previously skipped nested directory test (bug now fixed)

## Migration Guide

For users updating from a previous version:

### YAML Job Files

Update all `write-to-disk` output paths and `skip-if` patterns:

```yaml
# Before
- uses: write-to-disk
  output: ./output/{name}.txt

# After
- uses: write-to-disk
  output: ./output/{{name}}.txt
```

### TypeScript Code

If directly instantiating `WriteToDisk` with path templates:

```typescript
// Before
const action = new WriteToDisk("./output/{name}.txt");

// After
const action = new WriteToDisk("./output/{{name}}.txt");
```

### Skip Conditions

Update file-exist skip condition patterns:

```yaml
# Before
skip-if:
  - type: file-exist
    pattern: "./output/results-{stem}.txt"

# After
skip-if:
  - type: file-exist
    pattern: "./output/results-{{stem}}.txt"
```

## Summary

| What | Placeholder Style |
|------|-------------------|
| LLM prompts | `{{variable}}` |
| Content templates | `{{variable}}` |
| File path templates | `{{variable}}` |
| Skip condition patterns | `{{variable}}` |
| Batch file globs | `*` or `**` (unchanged) |