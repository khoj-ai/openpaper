#!/usr/bin/env bash
# Download the eval dataset from HuggingFace and convert it back to
# the local wrapper format expected by run_benchmark.py.
#
# Prerequisites:
#   - hf CLI installed and authenticated (hf auth login)
#
# Usage:
#   cd server
#   bash evals/download_evals_dataset.sh [output_path]

set -euo pipefail

HF_REPO="khoj-ai/openpaper-evals"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
OUTPUT_PATH="${1:-$SCRIPT_DIR/eval_dataset.json}"

# Check hf CLI is available and authenticated
if ! command -v hf &>/dev/null; then
    echo "Error: hf CLI not found. Install it first: https://huggingface.co/docs/huggingface_hub/guides/cli" >&2
    exit 1
fi

if ! hf auth whoami &>/dev/null; then
    echo "Error: Not logged in to HuggingFace. Run: hf auth login" >&2
    exit 1
fi

TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TMPDIR"' EXIT

echo "Downloading from $HF_REPO..."
hf download "$HF_REPO" eval_dataset.jsonl --repo-type dataset --local-dir "$TMPDIR"

if [ ! -f "$TMPDIR/eval_dataset.jsonl" ]; then
    echo "Error: Download failed — eval_dataset.jsonl not found" >&2
    exit 1
fi

echo "Converting JSONL to local wrapper format..."

python3 - "$TMPDIR/eval_dataset.jsonl" "$OUTPUT_PATH" << 'PYEOF'
import json, sys

jsonl_path, output_path = sys.argv[1], sys.argv[2]

METADATA_PREFIX = "metadata_"
METADATA_FIELDS = {"page_hint", "section", "chunk_description", "source_text"}

rows = []
with open(jsonl_path) as f:
    for line in f:
        line = line.strip()
        if not line:
            continue
        flat = json.loads(line)
        row = {}
        metadata = {}
        for k, v in flat.items():
            if k.startswith(METADATA_PREFIX) and k[len(METADATA_PREFIX):] in METADATA_FIELDS:
                metadata[k[len(METADATA_PREFIX):]] = v
            elif k == "judge_rubric":
                row[k] = v if v != "" else None
            else:
                row[k] = v
        row["metadata"] = metadata
        rows.append(row)

# Count unique papers
paper_ids = {r["paper_id"] for r in rows if "paper_id" in r}

dataset = {
    "version": "1.0",
    "total_rows": len(rows),
    "total_papers_processed": len(paper_ids),
    "rows": rows,
}

with open(output_path, "w") as f:
    json.dump(dataset, f, indent=2, ensure_ascii=False)

print(f"Wrote {len(rows)} rows to {output_path}")
PYEOF

echo "Done. Dataset saved to $OUTPUT_PATH"
