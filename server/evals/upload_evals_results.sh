#!/usr/bin/env bash
# Upload eval result files to HuggingFace.
#
# Uploads all JSON files from the local results/ directory into a
# results/ subfolder on the HF dataset repo.
#
# Prerequisites:
#   - hf CLI installed and authenticated (hf auth login)
#
# Usage:
#   cd server
#   bash evals/upload_evals_results.sh [path/to/results/dir]

set -euo pipefail

HF_REPO="khoj-ai/openpaper-evals"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
RESULTS_DIR="${1:-$SCRIPT_DIR/results}"

if [ ! -d "$RESULTS_DIR" ]; then
    echo "Error: Results directory not found: $RESULTS_DIR" >&2
    exit 1
fi

# Collect JSON files
shopt -s nullglob
JSON_FILES=("$RESULTS_DIR"/*.json)
shopt -u nullglob

if [ ${#JSON_FILES[@]} -eq 0 ]; then
    echo "Error: No JSON files found in $RESULTS_DIR" >&2
    exit 1
fi

# Check hf CLI is available and authenticated
if ! command -v hf &>/dev/null; then
    echo "Error: hf CLI not found. Install it first: https://huggingface.co/docs/huggingface_hub/guides/cli" >&2
    exit 1
fi

if ! hf auth whoami &>/dev/null; then
    echo "Error: Not logged in to HuggingFace. Run: hf auth login" >&2
    exit 1
fi

echo "Uploading ${#JSON_FILES[@]} result file(s) to $HF_REPO/results/..."

for file in "${JSON_FILES[@]}"; do
    filename="$(basename "$file")"
    echo "  $filename"
    hf upload "$HF_REPO" "$file" "results/$filename" --repo-type dataset
done

echo "Done. Results available at https://huggingface.co/datasets/$HF_REPO/tree/main/results"
