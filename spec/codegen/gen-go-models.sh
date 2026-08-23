#!/bin/bash
# Generates Go model types for api from the OpenAPI spec.
#
# Requires: go install github.com/deepmap/oapi-codegen/cmd/oapi-codegen@latest
#   Ensure $GOPATH/bin (or $GOBIN) is on your $PATH after installing.
#
# Usage: ./codegen/gen-go-models.sh
# Make this file executable: chmod +x codegen/gen-go-models.sh

set -e

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
OUTPUT_DIR="$SCRIPT_DIR/../../api/internal/model"

mkdir -p "$OUTPUT_DIR"

echo "Generating Go model types from $SCRIPT_DIR/../api/openapi.yaml ..."

oapi-codegen -generate types -package model "$SCRIPT_DIR/../api/openapi.yaml" > "$OUTPUT_DIR/openapi_types.go"

echo "Done. Go types written to $OUTPUT_DIR/openapi_types.go"
