# ![Open Paper](https://raw.githubusercontent.com/sabaimran/openpaper/refs/heads/master/client/src/app/openpaper.svg) Open Paper

**The fastest way to annotate and deeply understand research papers.**

Open Paper is a workspace for reading research. Upload your papers, highlight and annotate them, take notes, and ask questions — with an AI assistant that grounds every answer in verifiable citations you can click to jump straight to the source.

Try it at **[openpaper.ai](https://openpaper.ai)**.

![The Open Paper](./demo.gif)

## Why Open Paper?

Reading papers means constant context switching: looking up unfamiliar terms, chasing references, re-finding that one result you highlighted three papers ago. Open Paper brings all of that into one place, so you can stay in the flow of actually reading.

## Features

### Read with an AI assistant by your side

![ai copilot](https://assets.khoj.dev/op_chat_1.png)

Your paper and the AI assistant sit side by side, so you never leave the document. As soon as you upload a PDF, you get an AI-generated brief and starter questions to ground yourself before diving in. Every response uses contextual citations — click one and you're taken to the exact passage in the paper it came from. Trust, but verify.

> **Curious how we verify our answers?** We built [ResearchQA](https://arxiv.org/abs/2607.11074), a citation-grounded benchmark for scientific QA, to measure exactly that. See the [evaluation suite](./server/evals/README.md) for the methods, metrics, and how to run it yourself.

### Highlight, annotate, and take notes

![annotations](https://assets.khoj.dev/op_annotations_1.jpeg)

Select any text to highlight it, attach a comment, or send it to the AI assistant for a deeper explanation. Notes live in context with your paper, with a markdown view when you want it. Your annotations help you recall insights quickly and jump back to the parts that mattered.

### Organize papers into projects

Group related papers into projects and unlock cross-paper insights. Ask questions that span your whole collection, generate artifacts, and keep verifiable citations throughout. Data tables let you define custom schemas to extract key fields across every paper in a project — each cell grounded in its source — and export to CSV when you're ready to analyze.

### Understand topics across your library

Ask a research question and get a synthesized answer drawing on the papers in your library, so your accumulated reading actually compounds.

### Discover new papers

Search the open-access literature to find relevant papers, and pull them into your library with one click.

### Import from Zotero

Connect your Zotero account to import your existing library and keep it automatically in sync.

### Listen on the go

Generate audio overviews of your papers for when reading isn't an option.

## Self-hosting

Open Paper is open source, and you can run the full stack yourself. Fair warning: it's built primarily as a hosted service and isn't optimized for self-hosting, so expect some assembly (Postgres, S3-compatible storage, LLM API keys, background workers). The setup in [DEVELOPMENT.md](./DEVELOPMENT.md) is the best starting point.

## Contributing

Contributions are welcome! To get a local development environment running:

- **[DEVELOPMENT.md](./DEVELOPMENT.md)** — full setup guide: prerequisites, environment variables, and how to start all three services.
- **[server/README.md](./server/README.md)** — the FastAPI backend.
- **[client/README.md](./client/README.md)** — the Next.js web app.
- **[jobs/README.md](./jobs/README.md)** — the Celery worker for async processing (PDF parsing, Zotero sync, audio).

Found a bug or have a feature idea? [Open an issue](https://github.com/khoj-ai/openpaper/issues).

## License

Open Paper is licensed under the [AGPL-3.0](./LICENSE).
