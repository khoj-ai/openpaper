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

# Top-level fields that are duplicated inside `metadata` for some question types.
# We drop the top-level copy and keep only the flattened `metadata_*` version.
DUPLICATED_IN_METADATA = {"required_sections", "reasoning_chain", "false_premise"}

with open(output_path, "w") as out:
    for row in data["rows"]:
        flat = {}
        for k, v in row.items():
            if k == "metadata":
                for mk, mv in v.items():
                    flat[f"metadata_{mk}"] = mv
            elif k in DUPLICATED_IN_METADATA:
                continue
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

readme = f"""---
license: cc-by-nc-4.0
task_categories:
  - question-answering
language:
  - en
size_categories:
  - n<1K
pretty_name: ResearchQA
tags:
  - evaluation
  - scientific-papers
  - retrieval-augmented-generation
  - question-answering
---

# ResearchQA

A general-purpose evaluation dataset for scientific paper question-answering systems. Contains question-answer pairs generated from scientific papers across multiple domains.

Originally built for evaluating [Open Paper](https://openpaper.ai), but designed to be useful for any research paper QA or RAG system.

## Dataset Details

- **Version:** {data.get('version', '?')}
- **Created:** {data.get('created_at', '?')[:10]}
- **Source manifest:** `{data.get('source_manifest', '?')}`
- **Total rows:** {data.get('total_rows', '?')}
- **Papers processed:** {data.get('total_papers_processed', '?')}

## Schema

The dataset is a flat table where some fields are sparse — they are only populated for certain `question_type` values. The "Populated on" column below indicates which question types use each field; rows of other types will have `null` for that field.

### Always populated

| Field | Type | Description |
|---|---|---|
| `row_id` | string | Unique row identifier |
| `paper_id` | string | OpenAlex paper ID |
| `paper_doi` | string | Paper DOI |
| `paper_s3_url` | string | S3 URL for the paper PDF |
| `domain` | string | Subject domain |
| `question_type` | string | One of `lookup`, `comprehension`, `multi_hop`, `adversarial` (see below) |
| `question` | string | The evaluation question |
| `expected_answer` | string | Expected answer |
| `expected_references` | list[string] | Expected reference passages from the paper |
| `judge_rubric` | string | Rubric for LLM-as-judge scoring (empty string when not applicable) |

### Sparse fields

| Field | Type | Populated on | Description |
|---|---|---|---|
| `metadata_page_hint` | int | `lookup`, `comprehension` | Page number hint for the source chunk |
| `metadata_section` | string | `lookup`, `comprehension` | Section of the paper the source chunk came from |
| `metadata_chunk_description` | string | `lookup`, `comprehension` | Short description of the source chunk |
| `metadata_source_text` | string | `lookup`, `comprehension` | Verbatim source text from the paper |
| `metadata_required_sections` | list[string] | `multi_hop` | Distinct sections that must be combined to answer the question |
| `metadata_reasoning_chain` | string | `multi_hop` | Description of how the required sections connect to form the answer |
| `metadata_false_premise` | string | `adversarial` | Statement of what is wrong with the question's premise |
| `expected_refusal` | bool | `adversarial` | Whether refusing to answer is the correct response |

## Question Types

Each row's `question_type` indicates how the question was constructed and what the model is expected to do:

- **`lookup`** — A factual question whose answer is a specific passage in the paper. Tests verbatim retrieval. `expected_references` contains the exact source passage.
- **`comprehension`** — An abstractive question requiring synthesis, critique, or reasoning about implications within a single chunk of the paper. Scored against a per-question rubric (`judge_rubric`).
- **`multi_hop`** — A question that requires combining information from two or more distinct, distant sections of the paper. The answer must NOT be derivable from any single passage. `expected_references` contains one quote per required section, and `metadata_required_sections` / `metadata_reasoning_chain` describe how the hops connect.
- **`adversarial`** — A question with a *false premise*, or asking about something the paper does not address. The correct behavior is to identify the false premise and refuse to fabricate, not to produce a confident-sounding answer. `metadata_false_premise` states what is wrong with the question; `expected_refusal` indicates whether refusal is the correct response.

## Licensing

This dataset is released under [CC-BY-NC-4.0](https://creativecommons.org/licenses/by-nc/4.0/) **with the following carve-out**:

- **Covered by CC-BY-NC-4.0:** the questions, expected answers, judge rubrics, question-type taxonomy, dataset structure, and all annotations contributed by the dataset authors.
- **NOT covered by CC-BY-NC-4.0:** quoted passages from source scientific papers that appear in the `metadata_source_text` and `expected_references` fields. These passages remain under the copyright of their original publishers and authors, and are included here as short research excerpts for the purpose of evaluating question-answering systems. Use of these passages is subject to the original publishers' terms and applicable fair-use / fair-dealing provisions in your jurisdiction.

If you redistribute or build on this dataset, you must preserve this carve-out and not represent the embedded source passages as being licensed under CC-BY-NC-4.0.
"""

with open(output_path, "w") as f:
    f.write(readme)

print(f"Generated README at {output_path}")
PYEOF

echo "Uploading to $HF_REPO..."
hf upload "$HF_REPO" "$TMPDIR/eval_dataset.jsonl" eval_dataset.jsonl --repo-type dataset
hf upload "$HF_REPO" "$TMPDIR/README.md" README.md --repo-type dataset

echo "Done. Dataset available at https://huggingface.co/datasets/$HF_REPO"
