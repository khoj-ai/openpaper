#!/usr/bin/env bash
# Upload the eval dataset to HuggingFace.
#
# Converts the local eval_dataset.json (wrapper format with metadata + rows)
# into JSONL suitable for HF's dataset viewer, then uploads it along with
# a README dataset card.
#
# Prerequisites:
#   - hf CLI installed and authenticated (hf auth login)
#
# Usage:
#   cd server
#   bash evals/upload_evals_dataset.sh [path/to/eval_dataset.json]

set -euo pipefail

HF_REPO="khoj-ai/ResearchQA"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DATASET_PATH="${1:-$SCRIPT_DIR/eval_dataset.json}"

if [ ! -f "$DATASET_PATH" ]; then
    echo "Error: Dataset file not found: $DATASET_PATH" >&2
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

TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TMPDIR"' EXIT

echo "Converting $DATASET_PATH to JSONL..."

python3 - "$DATASET_PATH" "$TMPDIR/eval_dataset.jsonl" << 'PYEOF'
import json, sys

dataset_path, output_path = sys.argv[1], sys.argv[2]

with open(dataset_path) as f:
    data = json.load(f)

with open(output_path, "w") as out:
    for row in data["rows"]:
        flat = {}
        for k, v in row.items():
            if k == "metadata":
                for mk, mv in v.items():
                    flat[f"metadata_{mk}"] = mv
            elif k == "judge_rubric":
                flat[k] = v if v is not None else ""
            else:
                flat[k] = v
        out.write(json.dumps(flat, ensure_ascii=False) + "\n")

print(f"Wrote {len(data['rows'])} rows to {output_path}")
PYEOF

# Generate README dataset card from the dataset metadata
python3 - "$DATASET_PATH" "$TMPDIR/README.md" << 'PYEOF'
import json, sys

dataset_path, output_path = sys.argv[1], sys.argv[2]

with open(dataset_path) as f:
    data = json.load(f)

errors_section = ""
errors = data.get("errors", [])
if errors:
    items = "\n".join(f"- `{e['paper_id'].split('/')[-1]}` — {e.get('error', 'unknown error')}" for e in errors)
    errors_section = f"""
## Generation Errors

{len(errors)} papers failed during dataset generation:
{items}
"""

readme = f"""---
license: other
task_categories:
  - question-answering
language:
  - en
size_categories:
  - n<1K
pretty_name: OpenPaper Eval Dataset
tags:
  - evaluation
  - scientific-papers
  - retrieval-augmented-generation
---

# OpenPaper Eval Dataset

Evaluation dataset for the OpenPaper scientific paper Q&A system. Contains question-answer pairs generated from scientific papers across multiple domains.

## Dataset Details

- **Version:** {data.get('version', '?')}
- **Created:** {data.get('created_at', '?')[:10]}
- **Source manifest:** `{data.get('source_manifest', '?')}`
- **Total rows:** {data.get('total_rows', '?')}
- **Papers processed:** {data.get('total_papers_processed', '?')}

## Schema

| Field | Type | Description |
|---|---|---|
| `paper_id` | string | OpenAlex paper ID |
| `paper_doi` | string | Paper DOI |
| `paper_s3_url` | string | S3 URL for the paper PDF |
| `domain` | string | Subject domain |
| `metadata_page_hint` | int | Page number hint |
| `metadata_section` | string | Section of the paper |
| `metadata_chunk_description` | string | Description of the source chunk |
| `metadata_source_text` | string | Source text from the paper |
| `row_id` | string | Unique row identifier |
| `question_type` | string | Type of question (e.g. lookup) |
| `question` | string | The evaluation question |
| `expected_answer` | string | Expected answer |
| `expected_references` | list[string] | Expected reference passages |
| `judge_rubric` | string | Rubric for judging (if applicable) |
{errors_section}"""

with open(output_path, "w") as f:
    f.write(readme)

print(f"Generated README at {output_path}")
PYEOF

echo "Uploading to $HF_REPO..."
hf upload "$HF_REPO" "$TMPDIR/eval_dataset.jsonl" eval_dataset.jsonl --repo-type dataset
hf upload "$HF_REPO" "$TMPDIR/README.md" README.md --repo-type dataset

echo "Done. Dataset available at https://huggingface.co/datasets/$HF_REPO"
