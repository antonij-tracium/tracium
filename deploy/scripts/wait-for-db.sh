#!/bin/bash
# Usage: ./wait-for-db.sh <host> <port> [timeout_seconds]
set -e

HOST="$1"
PORT="$2"
TIMEOUT="${3:-60}"
ELAPSED=0

echo "Waiting for $HOST:$PORT..."
until nc -z "$HOST" "$PORT" 2>/dev/null; do
  if [ "$ELAPSED" -ge "$TIMEOUT" ]; then
    echo "Timeout waiting for $HOST:$PORT after ${TIMEOUT}s"
    exit 1
  fi
  sleep 2
  ELAPSED=$((ELAPSED + 2))
done
echo "$HOST:$PORT is available"
