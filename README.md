# PRD Studio

Turn a rough product idea into an implementation-ready build plan: discovery brief,
PRD, technical architecture, data model & API contracts, and a task list an AI coding
agent can execute — all as one Markdown document.

Version **0.2.0** adds **role-based model routing**: every stage calls a named role,
each role has a primary model plus fallbacks, and every call records the model that
actually served it together with its token usage and real cost.

- Local-first: runs on your machine, data lives in a local SQLite file.
- No vendor lock-in beyond any OpenAI-compatible endpoint (built for
  [InferHub](https://inferhub.dev)).
- Output is plain Markdown, safe to commit next to the code it describes.

---

## Table of contents

- [How it works](#how-it-works)
- [Requirements](#requirements)
- [Install](#install)
- [Configure](#configure)
- [Model routing](#model-routing)
- [Using the app](#using-the-app)
- [Updating an existing install](#updating-an-existing-install)
- [Clean reinstall](#clean-reinstall)
- [Run as a local service (Linux)](#run-as-a-local-service-linux)
- [Data and storage](#data-and-storage)
- [API](#api)
- [Project structure](#project-structure)
- [Troubleshooting](#troubleshooting)
- [Security notes](#security-notes)

---

## How it works

The pipeline runs five stages in order. Each stage is a separate model call, and each
maps to a role in the active routing profile:

| # | Stage | Role | Output |
|---|-------|------|--------|
| 1 | Discovery | `reasoning` | Product name, problem, users, scope, assumptions, open questions |
| 2 | Product requirements | `writer` | Vision, journeys, features, functional requirements, metrics |
| 3 | Technical architecture | `architect` | Stack, frontend, backend, data, deployment, risks |
| 4 | Data model & API | `contracts` | Entities, relationships, indexes, endpoint contracts |
| 5 | Implementation tasks | `tasks` | Phased, file-level task list for an AI coding agent |

Before the run starts, an optional **intake** step (`intake` role) asks only the
questions whose answers would change scope, architecture, or the data model. Unanswered
questions become explicitly tagged assumptions in the prompt.

Each stage receives the outputs of the earlier stages, so the document stays internally
consistent. The assembled Markdown records the profile and the model behind each
section:

```markdown
> Product requirements generated from a high-level idea.
> Profile: **Combo** · Reasoning: `cx/gpt-6.1-sol` · Writer: `zai/glm-5.3` · …
> Generated: 2026-10-19T15:17:08.512Z
```

---

## Requirements

- **Node.js 24 or newer** (`node:sqlite` is built in; Node 22 needs
  `--experimental-sqlite`).
- npm (ships with Node).
- An API key for an OpenAI-compatible chat-completions endpoint. Defaults to
  `https://api.inferhub.dev/v1`.

```bash
node -v   # v24.x or newer
```

---

## Install

```bash
git clone https://github.com/ZhayaGT/prd-studio.git
cd prd-studio
npm install
cp .env.example .env.local
# edit .env.local and set INFERHUB_API_KEY (or skip this and add the key
# later on the Settings page)
npm run dev
```

Open <http://localhost:3000>. With no key configured the app still starts: the
workspace and Settings page render, and generation returns a clear
`No InferHub API key` error until you add one.

For a production build:

```bash
npm run build
npm start          # http://localhost:3000
```

`npm start` needs a prior `npm run build`.

---

## Configure

Two ways to configure; the Settings page wins over environment variables.

### Option A — Settings page (recommended)

Open **Settings** from the workspace ("Open Settings" under Advanced settings) or go to
`/settings`:

1. **API key & endpoint** — paste the key, optionally override the base URL, then
   **Save & test**. The key is stored in the local SQLite database and only ever
   displayed masked (`sk-xxxx…abcd`).
2. **Profile** — pick Hemat / Combo / Maksimal and **Save profile**.
3. **Roles** — override the primary and up to three fallbacks per role.
4. **Bid caps & spend** — cap the price per million tokens; see
   [Bid caps](#bid-caps).

Leaving the key field blank keeps the stored key. An empty base URL falls back to the
environment variable, then to `https://api.inferhub.dev/v1`.

### Option B — environment variables

`.env.local` (never commit this file):

```dotenv
INFERHUB_API_KEY=your-inferhub-key
INFERHUB_BASE_URL=https://api.inferhub.dev/v1
```

Environment values are used when nothing is stored in Settings. The Settings page
reports whether a key is configured and never returns the raw key to the browser.

---

## Model routing

A **profile** is a preset role map. Every role has a `primary` model and an ordered
list of `fallbacks`; the first model that answers wins.

| Role | Used by | Default profile: Combo |
|------|---------|------------------------|
| `intake` | Clarify questions | `zai/glm-5.3-flash` |
| `reasoning` | Discovery brief | `cx/gpt-6.1-sol` |
| `writer` | Product requirements | `zai/glm-5.3` |
| `architect` | Technical architecture | `cb/deepseek-v4.1-flash` |
| `contracts` | Data model & API | `cb/deepseek-v4.1-flash` |
| `tasks` | Implementation tasks | `zai/glm-5.3` |

Built-in profiles:

- **Hemat** — cheapest models for every role.
- **Combo** (default) — a frontier model writes the short discovery brief; cheap models
  write the bulk document prose.
- **Maksimal** — frontier models everywhere, including Opus 5.5 for reasoning.

Role maps live in [`src/lib/profiles.ts`](src/lib/profiles.ts). Change a default there,
or override it per install on the Settings page.

### Fallbacks

Each role tries its primary, then fallback 1, fallback 2, … Only these conditions move
to the next model:

- HTTP 408/409/429/5xx, network failure, `no_capacity`, `upstream_chain_exhausted`
  (retried once on the same model after 700 ms, then the next model).
- `402` / `no_provider_under_bid` — no provider sits under your bid cap.
- An empty reply (a reasoning model that spent its whole output budget on its thinking
  trace).

The run fails only when the whole chain fails; the error names every model tried and
the active bid caps. A user pressing **Stop** aborts immediately and records no spend.

### Bid caps

Every request carries `x-max-input-price` / `x-max-output-price` when the cap is above
zero. The router may only use providers at or below that price. If a model you want is
rejected with `no_provider_under_bid`, raise the cap — or set it to `0` for no cap. The
app never silently retries above the cap.

Defaults: `0.2` USD per million input tokens, `1.0` per million output tokens. Prices on
the Settings page are the catalog **minimum ask**, not a guarantee; actual cost is read
from each response's `usage.cost` and summed per call.

### Spend accounting

Every call writes one row to `usage_log` with the stage, role, requested model, model
that actually answered, whether it was a fallback, input/output tokens, cost, duration,
and status. Project cost is the sum of its usage rows, so deleting a project does not
erase historical spend. Settings shows all-time and 30-day spend.

---

## Using the app

1. **Idea** — describe the product in your own words. Optionally pick a platform preset
   (web app, mobile, API, internal tool), output language, and routing profile.
2. **Confirm** — review the intake questions and the summary. Answer what matters;
   anything blank becomes a tagged assumption. **Generate PRD**.
3. **Generate** — watch each stage stream. The timeline shows the model serving each
   stage (and `(fallback)` when it differs from the primary), the run cost, and token
   counts. Stop at any time — nothing is saved until the run completes.
4. **After the run** — edit a section, regenerate one stage, or download the Markdown.
   Saved plans are listed under **History** and open at `/projects/<id>` with their
   profile, cost, and per-role models.

Regenerating a stage re-runs only that role and updates its entry in `project.models`;
downstream stages are marked stale so you can regenerate them for consistency.

---

## Updating an existing install

Applies to any install of the previous (0.1.x) version, including the systemd setup
described below.

**1. Stop the server** (skip if you run it with `npm run dev`):

```bash
systemctl --user stop prd-studio.service   # or: prd-studio-stop
```

**2. Back up the data and your key** — the database holds your saved plans, settings,
and spend history:

```bash
cd /path/to/prd-studio
cp -a data data.bak-$(date +%F)
cp -a .env.local .env.local.bak
```

**3. Update the code**:

```bash
git pull
npm install
```

`npm install` matters: `ai` and `@ai-sdk/openai-compatible` were removed in 0.2.0 and the
lockfile changed.

**4. Build and start**:

```bash
npm run build
npm start            # or restart your service, see below
```

**5. Verify** — open the app. The top bar should show `Combo · $0`, and **Settings**
should list the three profiles and the model catalog. Existing plans remain in History
and are labelled **Legacy** (they predate profiles); their documents and text are
untouched.

### Database migration

The schema upgrades itself on first start:

- `projects` gains `profile` and `models_json` (defaults `''` and `{}`).
- New tables: `settings`, `models`, `usage_log`; WAL journal mode and a 10 s busy
  timeout are enabled.
- Old rows keep `profile = ''` and `models = {}`, which the UI renders as **Legacy**.
  The obsolete `model` column stays in the table (unused) so no data is rewritten.

Migration is additive: no existing row is deleted or rewritten. If it fails, restore the
backup from step 2 and report the error.

### If the update goes wrong

```bash
git status                      # confirm no local edits are blocking the pull
git stash                       # park local edits, then: git stash pop
npm install                     # re-sync dependencies
rm -rf .next && npm run build    # clear a stale build cache
```

---

## Clean reinstall

Use this when you want a pristine checkout. **Your plans and settings live in `data/`,
not in the code**, so preserving that directory preserves everything.

```bash
# 1. Back up data and key
cp -a /path/to/old/prd-studio/data       ~/prd-studio-data.bak
cp -a /path/to/old/prd-studio/.env.local ~/prd-studio.env.local.bak

# 2. Fresh clone
git clone https://github.com/ZhayaGT/prd-studio.git
cd prd-studio
npm install

# 3. Restore data and key
cp -a ~/prd-studio-data.bak ./data
cp ~/prd-studio.env.local.bak ./.env.local

# 4. Build and run
npm run build
npm start
```

The restored database is migrated in place on first start (see above). If you would
rather start clean, skip the `data` restore — a new database is created automatically.

---

## Run as a local service (Linux)

Production mode does not hot-reload; rebuild after code changes.

`~/.config/systemd/user/prd-studio.service`:

```ini
[Unit]
Description=PRD Studio (local Next.js server)
After=network.target

[Service]
Type=simple
WorkingDirectory=%h/prd-studio
Environment=NODE_ENV=production
Environment=PRD_STUDIO_DATA_DIR=%h/prd-studio/data
ExecStart=/usr/bin/env next start -p 3111 -H 127.0.0.1
Restart=on-failure
RestartSec=2
RuntimeMaxSec=7200
SuccessExitStatus=143
StandardOutput=append:%h/.local/state/prd-studio/server.log
StandardError=append:%h/.local/state/prd-studio/server.log

[Install]
WantedBy=default.target
```

`ExecStart` assumes `next` is on `PATH` (e.g. a global install, `mise`/`nvm` shim, or an
absolute path to `node_modules/.bin/next`). Create the log directory once:

```bash
mkdir -p ~/.local/state/prd-studio
systemctl --user daemon-reload
systemctl --user enable --now prd-studio.service
```

The unit is deliberately **not** started at login by default (drop `enable` to keep it
on demand); `RuntimeMaxSec=7200` stops it after two hours. Logs:

```bash
journalctl --user -u prd-studio.service -f
tail -f ~/.local/state/prd-studio/server.log
```

After pulling an update:

```bash
cd ~/prd-studio
git pull
npm install
npm run build
systemctl --user restart prd-studio.service
```

Useful commands:

```bash
systemctl --user start   prd-studio.service
systemctl --user stop    prd-studio.service
systemctl --user restart prd-studio.service
systemctl --user status  prd-studio.service
```

---

## Data and storage

Everything is local.

| Path | Contents |
|------|----------|
| `data/prd-studio.db` | SQLite: projects, settings, model catalog, usage log |
| `.env.local` | API key and base URL (optional; Settings can hold the key instead) |

Override the data directory with `PRD_STUDIO_DATA_DIR`:

```bash
PRD_STUDIO_DATA_DIR=/srv/prd-studio npm start
```

The database uses WAL mode, so `data/` may contain `-wal` and `-shm` sidecars. Copy the
whole directory, or stop the server first, when backing up. All three files are
gitignored.

---

## API

All routes are server-side (`runtime = "nodejs"`). Streaming routes emit NDJSON, one
JSON event per line.

| Method | Route | Purpose |
|--------|-------|---------|
| `GET` | `/api/settings` | Settings, profiles, spend |
| `POST` | `/api/settings` | Update key/base URL/profile/roles/caps; `{ "test": true }` or `{ "refreshCatalog": true }` also refreshes the catalog |
| `GET` | `/api/models` | Model catalog (lazily fetched on first load) |
| `POST` | `/api/models` | Force a catalog refresh |
| `POST` | `/api/clarify` | Intake questions: `{ idea, language?, profile? }` |
| `POST` | `/api/generate` | Full pipeline: `{ idea, language?, preset?, brief?, profile? }` |
| `GET` | `/api/projects` | Saved plans |
| `GET` | `/api/projects/:id` | One plan, including stages, models, cost |
| `PATCH` | `/api/projects/:id` | Replace edited stage text: `{ stages: { prd: "…" } }` |
| `DELETE` | `/api/projects/:id` | Delete a plan (usage history is kept) |
| `POST` | `/api/projects/:id/regenerate` | Re-run one stage: `{ stage, preset?, profile? }` |

Pipeline events:

```ts
{ type: "stage_start", id, label, role, model }
{ type: "delta", id, text }
{ type: "stage_end", id, truncated, model, fallback, inputTokens, outputTokens, costUsd, ms }
{ type: "cost", totalUsd }
{ type: "done", project }
{ type: "error", message }
```

Example:

```bash
curl -sN -X POST http://127.0.0.1:3111/api/generate \
  -H 'Content-Type: application/json' \
  -d '{"idea":"Internal tool for a small cafe to track beans, recipes, and brew logs.","language":"English","preset":"internal"}'
```

---

## Project structure

```
src/
  app/
    page.tsx                      workspace: idea → confirm → generate
    settings/page.tsx             API key, profile, per-role models, bid caps, spend
    projects/[id]/page.tsx        saved plan with profile, cost, per-role models
    api/                          settings, models, clarify, generate, projects
  lib/
    profiles.ts                   profiles and their exact role maps
    rolecall.ts                   role call wrapper; the only writer of usage_log
    inferhub.ts                   raw OpenAI-compatible client (streaming, fallbacks, catalog)
    pipeline.ts                   stage orchestration and document assembly
    prompts.ts                    stage prompts and provenance header
    clarification.ts              intake schema, JSON repair, brief normalization
    store.ts                      SQLite schema, migrations, settings, usage
    settings.ts                   settings resolution, role sanitizing, key masking
    labels.ts / format.ts         UI labels and formatting
    types.ts / ui-types.ts        shared and client-side types
data/                             SQLite database (gitignored)
```

Checks:

```bash
npm run lint
npm run build
```

---

## Troubleshooting

**`no_provider_under_bid` / HTTP 402** — every provider for that model is above your
bid cap, or the ones under it are saturated. Raise the caps in Settings (or set `0` for
no cap), or pick a cheaper model for that role. The app intentionally does not retry
above the cap.

**`Empty reply from <model> … (finishReason: length)`** — the model spent its entire
output budget on reasoning. The chain already moved on to the next model; if the whole
chain failed, raise that role's budget or choose a non-reasoning model.

**A section is marked Truncated** — the stage hit `maxOutputTokens`. Regenerate that
stage, or edit it and save.

**`No InferHub API key`** — set the key on the Settings page or in `.env.local`, then
restart the server. `POST /api/settings` with `{"test": true}` verifies it.

**Catalog is empty or stale** — press **Refresh catalog** in Settings (or
`POST /api/models`). When the network or key is unavailable, the page still renders the
seeded fallback prices and shows the error.

**Port already in use** — `next start -p 3111` fails if something else holds the port:
`ss -ltnp | grep 3111`. Pick another port or stop the other process.

**Build errors after an update** — `rm -rf .next && npm run build`. Ensure Node is 24+.

**Node version error on start** — `node:sqlite` is required; upgrade Node or run Node 22
with `NODE_OPTIONS=--experimental-sqlite`.

---

## Security notes

- The API key never reaches the browser: it is read server-side and returned only
  masked. `Settings` carries `hasApiKey` and `apiKeyMasked`, never the raw value.
- `.env.local`, `data/`, and `*.db*` are gitignored. `.env.example` contains a
  placeholder only.
- No telemetry, no external calls other than the configured model endpoint (and its
  `/models` catalog).
- The server binds to `127.0.0.1` in the service example. Do not expose it publicly
  without adding authentication: it can spend your API credit.
- Deleting a plan removes its text but keeps its usage rows, so spend totals stay
  accurate. Clear `usage_log` manually if you want to reset them.
