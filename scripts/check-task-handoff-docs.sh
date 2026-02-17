#!/usr/bin/env bash

set -euo pipefail

BASE_BRANCH="${1:-origin/main}"
BRANCH="${2:-$(git rev-parse --abbrev-ref HEAD)}"

if [[ ! "$BRANCH" =~ ^feat/task- ]]; then
  echo "Branch '$BRANCH' is not a task branch. Skipping handoff doc check."
  exit 0
fi

if ! git show-ref --verify --quiet "refs/remotes/$BASE_BRANCH" \
  && ! git show-ref --verify --quiet "refs/heads/${BASE_BRANCH#origin/}"; then
  echo "Base branch '$BASE_BRANCH' not found. Set base branch or pass one explicitly."
  exit 1
fi

MERGE_BASE="$(git merge-base "$BRANCH" "$BASE_BRANCH")"
if [[ -z "$MERGE_BASE" ]]; then
  echo "Could not determine merge-base between '$BRANCH' and '$BASE_BRANCH'."
  exit 1
fi

missing=0
for doc in AGENTS.md progress.md; do
  if ! git diff --name-only "$MERGE_BASE" "$BRANCH" -- "$doc" | grep -qx "$doc"; then
    echo "Required handoff doc '$doc' is not updated in branch diff ($MERGE_BASE..$BRANCH)."
    missing=1
  fi
done

if [[ "$missing" -ne 0 ]]; then
  echo "Update both AGENTS.md and progress.md before pushing from task branch '$BRANCH'."
  echo "Command: pnpm run check:handoff"
  exit 1
fi

echo "Handoff docs check passed: AGENTS.md and progress.md updated in '$BRANCH'."
exit 0
