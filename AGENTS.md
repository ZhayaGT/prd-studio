<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Architecture invariants

Keep these true when changing the pipeline:

- **Roles, not models, at the call site.** Stage code asks for a `RoleId`
  (`intake`, `reasoning`, `writer`, `architect`, `contracts`, `tasks`); the profile
  map decides which model serves it. Model ids live only in `src/lib/profiles.ts`.
- **`src/lib/rolecall.ts` is the only writer of `usage_log`.** One row per call with
  the model that actually answered, `requested_model`, `fallback`, tokens, and
  `usage.cost`. Do not log spend anywhere else.
- **Never retry above the bid cap.** `402` / `no_provider_under_bid` moves to the next
  model in the role chain. Raising the cap is a user decision in Settings.
- **Abort is not a failure.** `AbortError` propagates untouched and writes no usage row.
- **Prompts are not the cost lever.** Routing decides who writes what; do not rewrite
  or truncate stage prompts to save tokens.
- **The document header records provenance** (profile + model per section) because AI
  coding agents read the Markdown.

## Data

SQLite at `data/prd-studio.db` (override with `PRD_STUDIO_DATA_DIR`). Schema
migrations are additive and idempotent — `src/lib/store.ts` adds columns and tables on
startup, and Next imports route modules in parallel workers, so migrations must
tolerate duplicate-column races. `projects.profile = ''` marks a pre-0.2 (Legacy) row.

Never commit `data/`, `.env.local`, or any API key. `.env.example` holds a placeholder.

## Checks

- `npm run lint`
- `npm run build`
