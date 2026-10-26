import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { FALLBACK_PRICES } from "./prices";
import type {
  BriefContext,
  ProfileId,
  ProjectRecord,
  ProjectSummary,
  StageId,
} from "./types";

const dataDir =
  process.env.PRD_STUDIO_DATA_DIR ?? path.join(process.cwd(), "data");
mkdirSync(dataDir, { recursive: true });

const db = new DatabaseSync(path.join(dataDir, "prd-studio.db"));

db.exec(`PRAGMA busy_timeout = 10000`);
db.exec(`PRAGMA journal_mode = WAL`);

db.exec(`
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    idea TEXT NOT NULL,
    model TEXT NOT NULL DEFAULT '',
    language TEXT NOT NULL,
    created_at TEXT NOT NULL,
    content TEXT NOT NULL,
    stages TEXT NOT NULL,
    profile TEXT NOT NULL DEFAULT '',
    models_json TEXT NOT NULL DEFAULT '{}'
  )
`);

/**
 * Adds a column to an existing database. Next imports route modules in parallel
 * workers, so a plain PRAGMA check races; a duplicate-column error means another
 * worker already migrated.
 */
function addColumn(table: string, name: string, ddl: string): void {
  const columns = db
    .prepare(`PRAGMA table_info(${table})`)
    .all() as unknown as Array<{ name: string }>;
  if (columns.some((c) => c.name === name)) return;
  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("duplicate column")) {
      throw error;
    }
  }
}

addColumn("projects", "preset", `preset TEXT NOT NULL DEFAULT ''`);
addColumn("projects", "brief_context", `brief_context TEXT NOT NULL DEFAULT ''`);
addColumn("projects", "profile", `profile TEXT NOT NULL DEFAULT ''`);
addColumn("projects", "models_json", `models_json TEXT NOT NULL DEFAULT '{}'`);

db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS models (
    id TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    publisher TEXT NOT NULL,
    modality TEXT NOT NULL DEFAULT '',
    context_limit INTEGER,
    max_output INTEGER,
    supports_cache INTEGER NOT NULL DEFAULT 0,
    reasoning_levels TEXT NOT NULL DEFAULT '[]',
    in_per_mtok REAL,
    out_per_mtok REAL,
    price_origin TEXT NOT NULL DEFAULT 'catalog',
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS usage_log (
    id TEXT PRIMARY KEY,
    project_id TEXT,
    stage TEXT NOT NULL,
    role TEXT NOT NULL,
    model TEXT NOT NULL,
    requested_model TEXT NOT NULL,
    fallback INTEGER NOT NULL DEFAULT 0,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    cost_usd REAL NOT NULL DEFAULT 0,
    ms INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL,
    error TEXT,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS usage_log_project ON usage_log(project_id);
`);

interface Row {
  id: string;
  title: string;
  idea: string;
  language: string;
  preset: string;
  profile: string;
  models_json: string;
  created_at: string;
  content: string;
  stages: string;
  brief_context: string;
  cost_usd: number;
}

const PROJECT_COLUMNS = `p.id, p.title, p.idea, p.language, p.preset, p.profile,
  p.models_json, p.created_at, p.content, p.stages, p.brief_context,
  COALESCE((SELECT SUM(u.cost_usd) FROM usage_log u WHERE u.project_id = p.id), 0) AS cost_usd`;

function parseBrief(raw: string): BriefContext | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as BriefContext;
    if (!parsed || typeof parsed !== "object") return null;
    return {
      summary: parsed.summary ?? "",
      answers: Array.isArray(parsed.answers) ? parsed.answers : [],
      assumptions: Array.isArray(parsed.assumptions) ? parsed.assumptions : [],
    };
  } catch {
    return null;
  }
}

function parseModels(raw: string): Record<string, string> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object") return {};
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "string") out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

function toSummary(row: Row): ProjectSummary {
  return {
    id: row.id,
    title: row.title,
    idea: row.idea,
    profile: row.profile as ProfileId | "",
    language: row.language,
    preset: row.preset,
    costUsd: row.cost_usd,
    createdAt: row.created_at,
  };
}

export function saveProject(input: {
  id: string;
  title: string;
  idea: string;
  profile: ProfileId | "";
  models: Record<string, string>;
  language: string;
  preset: string;
  createdAt: string;
  content: string;
  stages: Partial<Record<StageId, string>>;
  brief?: BriefContext | null;
}): ProjectSummary {
  db.prepare(
    `INSERT INTO projects (id, title, idea, model, language, preset, profile, models_json, created_at, content, stages, brief_context)
     VALUES (?, ?, ?, '', ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.id,
    input.title,
    input.idea,
    input.language,
    input.preset,
    input.profile,
    JSON.stringify(input.models),
    input.createdAt,
    input.content,
    JSON.stringify(input.stages),
    input.brief ? JSON.stringify(input.brief) : "",
  );
  return {
    id: input.id,
    title: input.title,
    idea: input.idea,
    profile: input.profile,
    language: input.language,
    preset: input.preset,
    costUsd: 0,
    createdAt: input.createdAt,
  };
}

export function updateProject(
  id: string,
  input: {
    title: string;
    content: string;
    stages: Partial<Record<StageId, string>>;
    preset?: string;
    profile?: ProfileId | "";
    models?: Record<string, string>;
  },
): ProjectSummary | null {
  const current = getProject(id);
  if (!current) return null;
  const result = db
    .prepare(
      `UPDATE projects SET title = ?, content = ?, stages = ?, preset = ?, profile = ?, models_json = ? WHERE id = ?`,
    )
    .run(
      input.title,
      input.content,
      JSON.stringify(input.stages),
      input.preset ?? current.preset,
      input.profile ?? current.profile,
      JSON.stringify(input.models ?? current.models),
      id,
    );
  if (result.changes === 0) return null;
  const row = db
    .prepare(`SELECT ${PROJECT_COLUMNS} FROM projects p WHERE p.id = ?`)
    .get(id) as unknown as Row;
  return toSummary(row);
}

export function listProjects(): ProjectSummary[] {
  const rows = db
    .prepare(`SELECT ${PROJECT_COLUMNS} FROM projects p ORDER BY p.created_at DESC`)
    .all() as unknown as Row[];
  return rows.map(toSummary);
}

export function getProject(id: string): ProjectRecord | null {
  const row = db
    .prepare(`SELECT ${PROJECT_COLUMNS} FROM projects p WHERE p.id = ?`)
    .get(id) as unknown as Row | undefined;
  if (!row) return null;
  return {
    ...toSummary(row),
    content: row.content,
    stages: JSON.parse(row.stages) as Partial<Record<StageId, string>>,
    brief: parseBrief(row.brief_context),
    models: parseModels(row.models_json),
  };
}

export function getProjectSummary(id: string): ProjectSummary | null {
  const row = db
    .prepare(`SELECT ${PROJECT_COLUMNS} FROM projects p WHERE p.id = ?`)
    .get(id) as unknown as Row | undefined;
  return row ? toSummary(row) : null;
}

export function deleteProject(id: string): boolean {
  const result = db.prepare(`DELETE FROM projects WHERE id = ?`).run(id);
  return result.changes > 0;
}

/* ---------- models ---------- */

export interface ModelRow {
  id: string;
  label: string;
  publisher: string;
  modality: string;
  context_limit: number | null;
  max_output: number | null;
  supports_cache: number;
  reasoning_levels: string;
  in_per_mtok: number | null;
  out_per_mtok: number | null;
  price_origin: string;
  updated_at: string;
}

export function replaceModels(rows: ModelRow[]): void {
  const now = new Date().toISOString();
  const upsert = db.prepare(
    `INSERT INTO models (id, label, publisher, modality, context_limit, max_output, supports_cache, reasoning_levels, in_per_mtok, out_per_mtok, price_origin, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       label = excluded.label,
       publisher = excluded.publisher,
       modality = excluded.modality,
       context_limit = excluded.context_limit,
       max_output = excluded.max_output,
       supports_cache = excluded.supports_cache,
       reasoning_levels = excluded.reasoning_levels,
       in_per_mtok = excluded.in_per_mtok,
       out_per_mtok = excluded.out_per_mtok,
       price_origin = excluded.price_origin,
       updated_at = excluded.updated_at`,
  );
  const existing = listModelRows();
  const keep = new Set<string>();
  db.exec(`BEGIN`);
  try {
    for (const row of rows) {
      keep.add(row.id);
      upsert.run(
        row.id,
        row.label,
        row.publisher,
        row.modality,
        row.context_limit,
        row.max_output,
        row.supports_cache,
        row.reasoning_levels,
        row.in_per_mtok,
        row.out_per_mtok,
        row.price_origin,
        row.updated_at || now,
      );
    }
    const remove = db.prepare(`DELETE FROM models WHERE id = ?`);
    for (const row of existing) {
      if (row.price_origin === "catalog" && !keep.has(row.id)) remove.run(row.id);
    }
    db.exec(`COMMIT`);
  } catch (error) {
    db.exec(`ROLLBACK`);
    throw error;
  }
}

export function listModelRows(): ModelRow[] {
  return db
    .prepare(
      `SELECT id, label, publisher, modality, context_limit, max_output, supports_cache, reasoning_levels, in_per_mtok, out_per_mtok, price_origin, updated_at
       FROM models ORDER BY id`,
    )
    .all() as unknown as ModelRow[];
}

export function modelsUpdatedAt(): string | null {
  const row = db
    .prepare(`SELECT MAX(updated_at) AS at FROM models WHERE price_origin = 'catalog'`)
    .get() as unknown as { at: string | null } | undefined;
  return row?.at ?? null;
}

export function seedFallbackPrices(prices: Record<string, [number, number]>): void {
  const now = new Date().toISOString();
  const read = db.prepare(`SELECT in_per_mtok FROM models WHERE id = ?`);
  const insert = db.prepare(
    `INSERT OR IGNORE INTO models (id, label, publisher, modality, context_limit, max_output, supports_cache, reasoning_levels, in_per_mtok, out_per_mtok, price_origin, updated_at)
     VALUES (?, ?, ?, '', NULL, NULL, 0, '[]', ?, ?, 'fallback', ?)`,
  );
  const update = db.prepare(
    `UPDATE models SET in_per_mtok = ?, out_per_mtok = ?, updated_at = ?
     WHERE id = ? AND price_origin = 'fallback' AND in_per_mtok IS NULL`,
  );
  for (const [id, [inPrice, outPrice]] of Object.entries(prices)) {
    const existing = read.get(id) as unknown as
      | { in_per_mtok: number | null }
      | undefined;
    if (!existing) {
      const slash = id.indexOf("/");
      insert.run(
        id,
        id,
        slash > 0 ? id.slice(0, slash) : "auto",
        inPrice,
        outPrice,
        now,
      );
      continue;
    }
    if (existing.in_per_mtok === null) {
      update.run(inPrice, outPrice, now, id);
    }
  }
}

/* ---------- settings ---------- */

export const SETTINGS_DEFAULTS: Record<string, string> = {
  profile: "combo",
  roles: "{}",
  bid_caps: '{"maxInputPrice":0.2,"maxOutputPrice":1.0}',
};

export function readAllSettings(): Record<string, string> {
  const rows = db
    .prepare(`SELECT key, value FROM settings`)
    .all() as unknown as Array<{ key: string; value: string }>;
  const out: Record<string, string> = { ...SETTINGS_DEFAULTS };
  for (const row of rows) out[row.key] = row.value;
  return out;
}

export function writeSetting(key: string, value: string): void {
  db.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run(key, value, new Date().toISOString());
}

/* ---------- usage ---------- */

export interface UsageInput {
  projectId: string | null;
  stage: string;
  role: string;
  model: string;
  requestedModel: string;
  fallback: boolean;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  ms: number;
  status: "ok" | "error";
  error?: string | null;
}

export function logUsage(input: UsageInput): void {
  db.prepare(
    `INSERT INTO usage_log (id, project_id, stage, role, model, requested_model, fallback, input_tokens, output_tokens, cost_usd, ms, status, error, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    randomUUID(),
    input.projectId,
    input.stage,
    input.role,
    input.model,
    input.requestedModel,
    input.fallback ? 1 : 0,
    input.inputTokens,
    input.outputTokens,
    input.costUsd,
    input.ms,
    input.status,
    input.error ?? null,
    new Date().toISOString(),
  );
}

export function totalSpendUsd(): { all: number; last30: number } {
  const all = db
    .prepare(`SELECT COALESCE(SUM(cost_usd), 0) AS total FROM usage_log`)
    .get() as unknown as { total: number };
  const last30 = db
    .prepare(
      `SELECT COALESCE(SUM(cost_usd), 0) AS total FROM usage_log WHERE created_at >= ?`,
    )
    .get(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()) as unknown as {
    total: number;
  };
  return { all: all.total, last30: last30.total };
}

// Unprefixed aliases are absent from the catalog, so seed their prices once at
// startup. Catalog rows overwrite these when refreshed.
seedFallbackPrices(FALLBACK_PRICES);
