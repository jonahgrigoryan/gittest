#!/usr/bin/env bash
set -euo pipefail

if [[ -n "${WAIT_FOR:-}" ]]; then
  IFS=',' read -ra targets <<<"$WAIT_FOR"
  for target in "${targets[@]}"; do
    host="${target%%:*}"
    port="${target##*:}"
    if [[ -z "$host" || -z "$port" ]]; then
      echo "[entrypoint] invalid WAIT_FOR target: $target" >&2
      continue
    fi
    echo "[entrypoint] waiting for $host:$port"
    for _ in {1..60}; do
      if nc -z "$host" "$port" >/dev/null 2>&1; then
        echo "[entrypoint] $host:$port is available"
        break
      fi
      sleep 1
    done
  done
fi

APP_START_CMD=${APP_START:-}
if [[ -z "$APP_START_CMD" ]]; then
  APP_START_CMD="node dist/index.js"
fi

if [[ -n "${APP_HOME:-}" && -d "$APP_HOME" ]]; then
  cd "$APP_HOME"
fi

exec bash -lc "$APP_START_CMD"
