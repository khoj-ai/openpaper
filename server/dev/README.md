# server/dev

Local development tooling. **Nothing here ships to production.**

`server/.dockerignore` excludes this directory from the build context, and
`server/Dockerfile` copies an explicit allowlist that does not include it. Both
are deliberate — keep it that way when adding files here.

Scripts in this directory may import from `app/` (they run inside the dev
server container, where `./server` is bind-mounted at `/app`), but nothing in
`app/` may import from here.

| File | Purpose |
| ---- | ------- |
| `build_dev_fixture.py` | Rebuilds `docker/seed/fixture.dump` from the PDFs in `server/evals/seed_data/` by pushing them through the real upload pipeline. Invoked via `scripts/dev build-fixture`. |
