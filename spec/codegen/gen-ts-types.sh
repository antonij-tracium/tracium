#!/bin/bash
# Generates TypeScript types for dashboard from the OpenAPI spec.
#
# Requires: npm install -g openapi-typescript
#   or run via npx (no global install needed — npx is used below).
#
# Usage: ./codegen/gen-ts-types.sh
# Make this file executable: chmod +x codegen/gen-ts-types.sh

set -e

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
OUTPUT_DIR="$SCRIPT_DIR/../../dashboard/src/types"

mkdir -p "$OUTPUT_DIR"

echo "Generating TypeScript types from $SCRIPT_DIR/../api/openapi.yaml ..."

npx openapi-typescript "$SCRIPT_DIR/../api/openapi.yaml" -o "$OUTPUT_DIR/openapi.d.ts"

echo "Done. Types written to $OUTPUT_DIR/openapi.d.ts"
