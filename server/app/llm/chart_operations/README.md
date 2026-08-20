# Chart operations

A chart is minutes of work spread over several agents, a thread pool, and a
sandbox. This is the map: who starts a chart, what runs where, and where each
stage's output ends up when something goes wrong.

## Getting started

- `__init__.py` — `create_chart_artifact`, the one path from a request to a
  chart. Read this first; everything below is a step in it.
- `planning.py` — what chart to draw, over which papers, and whether the corpus
  can fill it. Reads extracted text, cheaply, across the roster.
- `extraction.py` — a confirmed plan into cited points. Reads PDFs, one call
  per paper.
- `text.py` — are these two pieces of text the same thing, and where in a paper
  is this field named. Used by both halves.
- `quantities.py` — reading a number out of what a paper printed.

## Who starts one

```
          chat turn                           artifact panel
  the evidence-gathering model        (api/projects/project_charts_api.py)
  calls create_chart_artifact                        │
      (llm/chart_agent.py)                 user edited and confirmed
           │                               a plan in the composer
  scope, decided twice:                              │
   the tool's paper_ids, then                        │
   planning.resolve_chart_scope                      │
   as a narrowing guard                              │
           │                                         │
           │  guard is unsure ──> no job; the model  │
           │  asks the user which papers it meant    │
           │                                         │
           └───────────────────┬─────────────────────┘
                               ▼
                 ChartGenerationJob  (row, status PENDING)
                    prompt · paper_ids · plan-or-null
                               │
                               │  FastAPI BackgroundTasks, dispatched
                               │  only once the turn's message exists
                               ▼
             tasks/chart_generation.generate_chart
             its own DB session, outliving the request
```

Chat's trigger is a tool call, not a keyword match: the model that has just
read the papers is the one that decides a chart is wanted, and it passes a
self-contained restatement of the request rather than the raw user message, so
"chart that against sample size" arrives as something a planner can act on. The
tool starts the job and returns immediately; its acknowledgement is the model's
only knowledge of the chart, which is why it can describe that one is coming
without inventing what it shows.

Nothing waits on a chart. Both surfaces queue a job and watch it: the job's
card polls, and a job raised from chat also posts its outcome back into the
thread that asked (`_reply_in_conversation`), because that turn was answered
minutes earlier and a failure has nowhere else to appear.

The composer confirms a plan before queueing, so its jobs carry one and skip
straight to step 3. A chat job carries `plan=null` and plans for itself — the
slow half, and the reason this runs in the background at all.

## How one fans out

```
create_chart_artifact(prompt, papers, plan=None)
│
├─ 1. DISCOVER ─── planning.investigate_chart_fields(plan=None)
│                  One agent, the whole roster, extracted text only.
│                  "What could this corpus be charted on?"
│                  SKIPPED when the composer already confirmed a plan.
│                        │
│                        ▼  evidence lines, merged and deduped
│
├─ 2. PROPOSE ──── planning.propose_chart_plan
│                  Several candidate plans, not one: committing to a field
│                  name before anyone knows how many papers report it is how
│                  a chart ends up with a single bar.
│                        │
│                        ├─ measure_plan_coverage scores each candidate
│                        │  against the roster — deterministic, no model
│                        └─ nothing scores? ──> clarification, job FAILED,
│                           posted back to the thread. Stops here.
│                        ▼  one ChartPlan (x, y, series?, calculation?)
│
├─ 3. VERIFY ───── planning.investigate_chart_fields(plan=…)
│                  a) an agent reads for the plan's exact fields
│                  b) planning.sweep_plan_evidence — deterministic, EVERY
│                     paper, whatever the agent did or didn't search
│                        │
│                        │  (b) is why a paper's absence from the chart means
│                        │  "we looked and it isn't there" rather than "the
│                        │  agent didn't happen to search here". Coverage is
│                        │  obligatory, not emergent.
│                        │
│                        └─ duplicate papers dropped from the roster here,
│                           so "3 of 249" counts 249 distinct studies
│                        ▼
│
└─ 4. EXTRACT ──── extraction.build_chart_artifact
                   │
                   ├─ _plan_screen ── scores each paper's gathered text
                   │                  against the plan; unscored papers are
                   │                  never opened. Reading the PDF is the
                   │                  expensive step, not finding it.
                   │
                   ├─ _paper_pdf ──── the stored PDF, per shortlisted paper.
                   │                  No PDF is an indexing failure, reported
                   │                  as such — falling back to extracted
                   │                  text is what put wrong numbers on
                   │                  charts.
                   │
                   ├─ extract ─────── ThreadPoolExecutor, EXTRACTION_WORKERS
                   │    ┌──────┬──────┬──────┬─── … 12 wide, one call per
                   │    ▼      ▼      ▼      ▼     paper, whole PDF in.
                   │  paper  paper  paper  paper   One bad response costs
                   │    A      B      C      D     one paper, not the chart.
                   │    └──────┴──┬───┴──────┘
                   │              ▼  quoted values + exact supporting quote
                   │
                   ├─ _read_quantity ─ the number the quoted text carries.
                   │                   `value` stays as the paper printed it,
                   │                   so the quote still matches.
                   │
                   ├─ _convert_to_plan_units ──> helpers/unit_conversion
                   │        One E2B sandbox run for every conversion in the
                   │        chart. The model authors one lambda per value and
                   │        nothing else; our harness runs them. A lambda that
                   │        fails costs its own point.
                   │
                   ├─ _compute_derived_y ─ when the plan has a calculation,
                   │                       from cited primitives only.
                   │
                   └─ _papers_collide_on_x ─ several papers on the same x?
                                             then the study is what tells the
                                             points apart: series_by_paper.
                   ▼
        ChartArtifactPayload ──> artifacts table (joined-table inheritance)
                                 attached to the message that asked, so the
                                 pending card in that turn becomes the chart
```

## Where output lands when it goes wrong

Nothing here fails silently, and each stage has one place it reports to:

| What happened | Where it shows up |
|---|---|
| Chat request's scope was ambiguous | the tool result; the model asks, no job |
| Chat request outside a project | the tool result; charts need a project to belong to |
| No plan the corpus supports | `job.error_message`, and posted to the thread |
| A paper wasn't shortlisted, or reported nothing | `coverage.excluded[paper_id]`, shown as "not charted" |
| A paper has no stored PDF | `coverage.excluded`, named as an indexing failure |
| A unit couldn't be converted | `payload.warnings` + the record's `exclusion_reason` |
| Every stage's narration | `job.trace` and `payload.investigation_trace` |
| A run that stopped making progress | swept by `chart_job_crud.fail_stale`, on read |

## Two properties worth preserving

These are load-bearing, and the reason several steps look redundant:

- **Coverage is obligatory, not emergent.** The investigator agent searches
  wherever its terms lead it; on top of that, every selected paper gets the
  deterministic plan-driven sweep. Remove the sweep and a paper's absence stops
  meaning anything.
- **Extraction is per paper.** One call each, so a large corpus can't crowd out
  the tail of the roster and one bad response can't take the whole chart down.

A chart that quietly changes between identical requests is not trustworthy even
when every bar is cited.
