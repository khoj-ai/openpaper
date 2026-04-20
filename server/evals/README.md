# OpenPaper Eval Suite

Measures how well the OpenPaper chat-with-paper pipeline answers questions about research papers, compared against a baseline of sending the raw PDF directly to an LLM.

## Why

We need to know whether the retrieval, citation, and prompting harness actually improves answer quality over a naive "throw the PDF at the model" approach. This suite gives us repeatable numbers on factual accuracy, completeness, groundedness, citation precision/recall, and latency across providers and domains.

## Pipeline

```
collect_papers.py -> generate_dataset.py -> run_benchmark.py
```

### 1. `collect_papers.py` -- Build the paper corpus

Queries OpenAlex for open-access papers across domains (biology, ML, psychology, etc.), downloads PDFs, validates them, and uploads to S3. Outputs `benchmark_manifest.json`.

```bash
cd server
uv run python -m evals.collect_papers [OPTIONS]
```

### 2. `generate_dataset.py` -- Generate eval questions

Reads the manifest, sends each paper's PDF to an LLM, and generates question/answer/citation triples. Outputs `eval_dataset.json` with question types (factual, comparative, methodological, etc.) and expected references.

```bash
cd server
uv run python -m evals.generate_dataset [OPTIONS]
```

### 3. `run_benchmark.py` -- Run and grade

Runs each question through either the full OpenPaper harness or a baseline (raw PDF + LLM), then grades with citation metrics and an LLM-as-judge.

```bash
cd server

# Default: 100 evenly-sampled questions, gemini provider
uv run python -m evals.run_benchmark

# Full dataset
uv run python -m evals.run_benchmark --full

# Baseline mode (raw PDF, no harness)
uv run python -m evals.run_benchmark --baseline

# Specific provider
uv run python -m evals.run_benchmark --provider openai

# Compare all providers
uv run python -m evals.run_benchmark --compare

# Compare single provider harness vs baseline
uv run python -m evals.run_benchmark --compare --provider gemini
```

Key flags:
- `--full` -- Run entire dataset (default samples 100 evenly-spaced rows)
- `--limit N` -- Sample N evenly-spaced rows
- `--baseline` -- Skip the harness, send PDF directly to the LLM
- `--batch-size N` -- Parallel questions per batch (default 5)
- `--compare` -- Print comparison table and exit
- `--skip-setup` -- Skip user/paper scaffolding on re-runs
- `--skip-grading` -- Skip LLM-as-judge, only compute citation metrics

## Results

Results are saved to `evals/results/` as `eval_{provider}.json` and `eval_{provider}_baseline.json`. Runs are resumable -- re-running the same command picks up where it left off.

## Metrics

| Metric | Source | Description |
|---|---|---|
| Factual accuracy | LLM judge (1-5) | Are the facts correct? |
| Completeness | LLM judge (1-5) | Does the answer cover all key points? |
| Groundedness | LLM judge (1-5) | Is the answer grounded in paper content? |
| Citation precision | Automated | Fraction of returned citations matching expected |
| Citation recall | Automated | Fraction of expected citations found |
| Citation accuracy | Automated | Do cited passages actually exist in the paper? |
