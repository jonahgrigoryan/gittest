#!/usr/bin/env bash
set -euo pipefail

BRANCH="${1:-m3/task17-production-hardening}"

git push -u origin "$BRANCH"
bash tools/ci-watch.sh "$BRANCH"