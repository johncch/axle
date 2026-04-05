# Human Workflows

## Release Workflow

1. If model lists are part of the release, run `pnpm run update-models` first.
2. Generate the changelog before creating the release tag:
   `pnpm run changelog -- version=0.10.0`
3. Review the generated `CHANGELOG.md`.
4. Run `pnpm run release -- 0.10.0` to run tests, build, and create the version commit/tag.
5. Push the release commit and tag.

Notes:
- Do not run `pnpm run release` before `pnpm run changelog`. The changelog job uses `git describe --tags --abbrev=0`, so tagging first makes the changelog range empty or incorrect.
- Use a semver version like `0.10.0`, not `v0.10`.
