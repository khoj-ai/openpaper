#!/usr/bin/env bash
# Download eval result files from HuggingFace.
#
# Downloads all files from the results/ subfolder on the HF dataset
# repo into the local results/ directory.
#
# Prerequisites:
#   - hf CLI installed and authenticated (hf auth login)
#
# Usage:
#   cd server
#   bash evals/download_evals_results.sh [output/dir]

set -euo pipefail

HF_REPO="khoj-ai/ResearchQA"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
OUTPUT_DIR="${1:-$SCRIPT_DIR/results}"

# Check hf CLI is available and authenticated
if ! command -v hf &>/dev/null; then
    echo "Error: hf CLI not found. Install it first: https://huggingface.co/docs/huggingface_hub/guides/cli" >&2
    exit 1
fi

if ! hf auth whoami &>/dev/null; then
    echo "Error: Not logged in to HuggingFace. Run: hf auth login" >&2
    exit 1
fi

mkdir -p "$OUTPUT_DIR"

echo "Downloading results from $HF_REPO..."
hf download "$HF_REPO" --repo-type dataset --include "results/*.json" --local-dir "$OUTPUT_DIR"

# hf download preserves the results/ subdirectory structure, so move files up
if [ -d "$OUTPUT_DIR/results" ]; then
    mv "$OUTPUT_DIR"/results/*.json "$OUTPUT_DIR"/ 2>/dev/null || true
    rmdir "$OUTPUT_DIR/results" 2>/dev/null || true
fi

echo "Done. Results saved to $OUTPUT_DIR"
