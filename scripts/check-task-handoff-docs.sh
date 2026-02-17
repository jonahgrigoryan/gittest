#!/usr/bin/env bash

set -euo pipefail

AUTO_FIX=0
POSITIONAL=()
for arg in "$@"; do
  case "$arg" in
    --fix)
      AUTO_FIX=1
      ;;
    *)
      POSITIONAL+=("$arg")
      ;;
  esac
done

BASE_BRANCH="${POSITIONAL[0]:-origin/main}"
BRANCH="${POSITIONAL[1]:-$(git rev-parse --abbrev-ref HEAD)}"

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

if [[ "$missing" -ne 0 && "$AUTO_FIX" -eq 1 ]]; then
  echo "Attempting auto-fix via tools/update-handoff-docs.mjs..."
  node tools/update-handoff-docs.mjs "$BASE_BRANCH" "$BRANCH"
  echo "Auto-fix applied local changes to AGENTS.md and progress.md."
  echo "Stage/commit those files, then rerun:"
  echo "  pnpm run check:handoff"
  exit 1
fi

if [[ "$missing" -ne 0 ]]; then
  echo "Update both AGENTS.md and progress.md before pushing from task branch '$BRANCH'."
  echo "Commands:"
  echo "  pnpm run handoff:update"
  echo "  pnpm run check:handoff"
  echo "Or one-step auto-fix:"
  echo "  pnpm run check:handoff:fix"
  exit 1
fi

echo "Handoff docs check passed: AGENTS.md and progress.md updated in '$BRANCH'."
exit 0
