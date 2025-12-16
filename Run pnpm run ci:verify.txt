#!/usr/bin/env bash
set -euo pipefail

BRANCH="${1:-m3/task17-production-hardening}"

# Get latest run for this workflow+branch
RUN_ID="$(gh run list --workflow ci.yml --branch "$BRANCH" --limit 1 --json databaseId -q '.[0].databaseId')"

echo "Watching workflow ci.yml on branch $BRANCH (run $RUN_ID)"
if gh run watch "$RUN_ID" --exit-status --compact; then
  echo "CI passed."
  exit 0
fi

echo "CI failed. Writing failed-step logs to ci-failure.log"
# If your gh version supports it, this is cleaner than dumping everything:
if gh run view "$RUN_ID" --log-failed >/tmp/ci_failed_steps.log 2>/dev/null; then
  cat /tmp/ci_failed_steps.log > ci-failure.log
else
  # Fallback: full logs
  gh run view "$RUN_ID" --log > ci-failure.log
fi

echo "Saved: $(pwd)/ci-failure.log"