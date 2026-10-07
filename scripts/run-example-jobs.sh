#!/usr/bin/env bash
# Usage: scripts/run-example-jobs.sh [job files...]   (default: examples/jobs/*)
# Starts the wordcount MCP server on :3100 for mcp-http.job.yml.
set -o pipefail

cd "$(dirname "$0")/.."

jobs=("$@")
if [ ${#jobs[@]} -eq 0 ]; then
  jobs=(examples/jobs/*.y*ml)
fi


node --import tsx examples/mcps/wordcount-server.ts --http --port 3100 >/dev/null 2>&1 &
mcp_pid=$!
trap 'kill $mcp_pid 2>/dev/null' EXIT

for _ in $(seq 50); do
  curl -s -o /dev/null http://localhost:3100/mcp && break
  sleep 0.2
done

passed=()
failed=()
for job in "${jobs[@]}"; do
  echo
  echo "━━━ $job"
  if pnpm exec tsx --conditions=axle-source packages/axle-cli/src/cli.ts -j "$job" --renderer plain --no-log </dev/null; then
    passed+=("$job")
  else
    failed+=("$job")
  fi
done

echo
echo "━━━ ${#passed[@]} passed, ${#failed[@]} failed"
for job in "${failed[@]}"; do
  echo "  ✗ $job"
done

[ ${#failed[@]} -eq 0 ]
