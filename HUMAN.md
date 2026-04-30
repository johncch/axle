# Human Workflows

## Release Workflow

If model lists are part of the release, run `pnpm run update-models` first. Then pick a path:

### One-shot (preferred)

```
pnpm run cut-release patch        # 0.11.0 -> 0.11.1
pnpm run cut-release minor        # 0.11.0 -> 0.12.0
pnpm run cut-release major        # 0.11.0 -> 1.0.0
pnpm run cut-release 0.12.5       # explicit version still works
```

The wrapper:

1. Computes the next version once from `package.json`.
2. Runs the changelog job with that version.
3. Pauses so you can review `CHANGELOG.md` (press `y` to continue, anything else aborts).
4. Runs tests, build, and `npm version` to create the version commit and tag.

After it finishes, push with `git push --follow-tags`.

### Manual (escape hatch)

If you want to control the steps yourself or pass an unusual version string:

1. `pnpm run changelog -- version=0.10.0` — generate changelog entry.
2. Review `CHANGELOG.md`.
3. `git add CHANGELOG.md && git commit -m "Update changelog for 0.10.0"` — `npm version` requires a clean tree, so commit the changelog first.
4. `pnpm run release -- 0.10.0` — tests, build, and version commit/tag.
5. `git push --follow-tags`.

## Notes

- Do not run `pnpm run release` before `pnpm run changelog`. The changelog job uses `git describe --tags --abbrev=0`, so tagging first makes the changelog range empty or incorrect. The one-shot wrapper handles this ordering for you.
- Use a semver version like `0.10.0`, not `v0.10`.
