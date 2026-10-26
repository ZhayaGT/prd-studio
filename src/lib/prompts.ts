import type { ProfileId, RoleId, StageContext, StageSpec } from "./types";
import { presetBlock } from "./presets";
import { briefBlock } from "./clarification";
import { PROFILE_LABELS, ROLE_SHORT_LABELS } from "./labels";

const BASE_SYSTEM = `You are a senior product and engineering lead who writes implementation-ready documents for software teams and AI coding agents.

Non-negotiable output rules:
- Output only the requested document. No preamble, no closing remarks, no meta commentary.
- Never wrap the whole document in a code fence.
- Start headings at level 3 (###). Never emit a level-1 or level-2 heading.
- Do not restate the document title as a heading; begin directly with the first subsection.
- Be concrete: names, numbers, and testable statements instead of adjectives.
- Never invent facts about the user's business. When you infer, tag it inline as [ASSUMPTION: ...].
- Use markdown tables where they improve clarity.
- Keep stable IDs (UJ-n, FR-n, SM-n, T-nnn) so other documents can reference them.`;

const DISCOVERY_SYSTEM = `${BASE_SYSTEM}

You are running discovery. Turn a vague idea into a sharp, testable brief that later documents will build on.`;

const PRD_SYSTEM = `${BASE_SYSTEM}

You are a product manager writing a rigorous PRD. Prioritize journeys that force real decisions (auth, data ownership, failure modes) and requirements that an engineer can test.`;

const ARCHITECTURE_SYSTEM = `${BASE_SYSTEM}

You are a software architect. Every technology choice needs a stated reason and a named alternative that was rejected. Prefer boring, proven technology unless the product genuinely needs otherwise. Include concrete numbers for non-functional targets.`;

const DATA_API_SYSTEM = `${BASE_SYSTEM}

You are a backend engineer defining data and interface contracts. Schemas must be complete enough to implement directly: field names, types, constraints, nullability, defaults, indexes. Endpoints must specify method, path, request, response, and error cases.`;

const TASKS_SYSTEM = `${BASE_SYSTEM}

You are a tech lead breaking a plan into executable tasks for AI coding agents. Each task must be small, independently completable, and name the exact file path it touches. Order by dependency.`;

const languageRule = (language: string) =>
  `Write all prose in ${language}. Keep code, file paths, identifiers, and technology names in their original form.`;


export function buildStagePrompt(
  stage: StageSpec,
  ctx: StageContext,
): { system: string; prompt: string } {
  const { system, prompt } = stage.build(ctx);
  const extra = [presetBlock(ctx.preset), briefBlock(ctx.brief)].filter(Boolean);
  return {
    system,
    prompt: extra.length ? `${prompt}\n\n${extra.join("\n\n")}` : prompt,
  };
}

export const STAGES: StageSpec[] = [
  {
    id: "discovery",
    role: "reasoning",
    label: "Discovery Brief",
    blurb: "Membaca ide, memetakan masalah, pengguna, batasan, dan asumsi.",
    maxOutputTokens: 8000,
    build: ({ idea, language }) => ({
      system: DISCOVERY_SYSTEM,
      prompt: `Product idea (high level):
"""
${idea}
"""

Produce a Discovery Brief with exactly this structure:

### Product Name
**Name:** <short product name>
**One-liner:** <one sentence, under 140 characters>

### Problem & Context
### Target Users & Jobs To Be Done
### Value Proposition
### Scope Boundaries
**In scope (v1):** bulleted
**Out of scope (v1):** bulleted

### Assumptions & Risks
A table with columns: Type | Statement | Impact if wrong

### Open Questions
Numbered list of the genuinely unresolved decisions.

${languageRule(language)}`,
    }),
  },
  {
    id: "prd",
    role: "writer",
    label: "Product Requirements",
    blurb: "Menyusun PRD lengkap: visi, user journey, fitur, FR, metrik.",
    maxOutputTokens: 14000,
    build: ({ idea, language, discovery }) => ({
      system: PRD_SYSTEM,
      prompt: `Original idea:
"""
${idea}
"""

Discovery brief:
"""
${discovery ?? "(none)"}
"""

Write the Product Requirements Document using exactly this structure:

### Vision
Two to three paragraphs: what this is, what it does for the user, why it matters.

### Target Users
#### Jobs To Be Done
Bulleted, covering functional, emotional, and social jobs.
#### Non-Users (v1)
Who this is explicitly not for in v1.
#### Key User Journeys
Number them UJ-1 through UJ-N, most important first. For each: persona and context, entry state, path (3-5 concrete beats), climax, resolution, and one edge case.

### Glossary
Every domain noun used later in the document, defined once. No synonyms elsewhere.

### Features
One subsection per coherent feature, formatted as:

#### Feature: <name>
**Description:** behavioral narrative; reference the journeys it realizes (realizes UJ-x).
**Functional Requirements:**
**FR-n — <capability>.** <Actor> can <capability> under <conditions>. Realizes UJ-x.
**Consequences (testable):**
- <specific, testable condition>
- <specific, testable condition>

Number FRs globally across all features.

### Non-Goals (Explicit)
What this product is not and will not do in v1.

### MVP Scope
**In scope:** bulleted
**Out of scope for MVP:** bulleted, each with a one-line reason

### Success Metrics
**Primary** — SM-n: metric, definition, target. Validates FR-x.
**Secondary**
**Counter-metrics (do not optimize)** — and why not.

### Open Questions
Numbered.

${languageRule(language)}`,
    }),
  },
  {
    id: "architecture",
    role: "architect",
    label: "Technical Architecture",
    blurb: "Memilih tech stack dan merancang frontend, backend, data, deploy.",
    maxOutputTokens: 16000,
    build: ({ idea, language, discovery, prd }) => ({
      system: ARCHITECTURE_SYSTEM,
      prompt: `Original idea:
"""
${idea}
"""

Discovery brief:
"""
${discovery ?? "(none)"}
"""

Product requirements:
"""
${prd ?? "(none)"}
"""

Design the technical architecture using exactly this structure:

### Stack Decision
A table: Layer | Choice | Why | Alternatives rejected.

### System Overview
The main components and how data flows between them. Include a mermaid diagram.

### Frontend
Framework and version, routing, state management, UI/styling approach, data fetching, and the key screens with their purpose.

### Backend
Runtime and framework, service boundaries, background jobs, authentication and authorization model, and third-party integrations.

### Data & Storage
Primary database and why, caching, file/object storage, search, and the migration strategy.

### Infrastructure & Deployment
Hosting, environments (local/staging/production), CI/CD, observability (logs, metrics, tracing), and secrets management.

### Security, Privacy & Compliance
Threat model highlights, data protection, and any regulatory constraints that apply.

### Non-Functional Requirements
A table: Attribute | Target | How it is measured. Include concrete numbers for latency, throughput, availability, and cost.

### Repository Structure
A code block with the concrete folder tree for the chosen stack.

### Technical Risks & Mitigations
A table: Risk | Likelihood | Impact | Mitigation.

${languageRule(language)}`,
    }),
  },
  {
    id: "dataApi",
    role: "contracts",
    label: "Data Model & API",
    blurb: "Menyusun skema entitas, relasi, dan kontrak endpoint.",
    maxOutputTokens: 20000,
    build: ({ idea, language, prd, architecture }) => ({
      system: DATA_API_SYSTEM,
      prompt: `Original idea:
"""
${idea}
"""

Product requirements:
"""
${prd ?? "(none)"}
"""

Technical architecture:
"""
${architecture ?? "(none)"}
"""

Define the data model and API contracts using exactly this structure:

### Entity Overview
A table: Entity | Purpose | Key fields.

### Entities
One subsection per entity:

#### <EntityName>
A table: Field | Type | Constraints | Notes.

### Relationships
Cardinality and foreign keys, including cascade behavior.

### Indexes & Performance Notes
The indexes required for the known query patterns.

### API Conventions
Base path, versioning, authentication header, pagination, and idempotency approach.

### Endpoints
One subsection per endpoint:

#### <METHOD> <path>
**Purpose:** one line.
**Auth:** required role or scope.
**Request:** body/query fields with types.
**Response:** status code and JSON shape.
**Errors:** the error codes and when each is returned.

### Validation & Error Model
The standard error envelope and validation rules shared across endpoints.

Scope rule: cover only the entities and endpoints required by the MVP scope. Include only fields the MVP features actually need, and keep each endpoint to at most six lines.

${languageRule(language)}`,
    }),
  },
  {
    id: "tasks",
    role: "tasks",
    label: "Implementation Tasks",
    blurb: "Memecah rencana menjadi task siap dieksekusi AI coding agent.",
    maxOutputTokens: 16000,
    build: ({ idea, language, prd, architecture, dataApi }) => ({
      system: TASKS_SYSTEM,
      prompt: `Original idea:
"""
${idea}
"""

Product requirements:
"""
${prd ?? "(none)"}
"""

Technical architecture:
"""
${architecture ?? "(none)"}
"""

Data model and API contracts:
"""
${dataApi ?? "(none)"}
"""

Break the work into an executable task list using exactly this structure:

Format for every task line:
- [ ] T001 [P] [US1] <action> in <exact/file/path>
Where [P] marks tasks that can run in parallel (different files, no dependency) and [USn] maps the task to a user story from the PRD. Number tasks globally from T001.

### Phase 1 — Setup
Project initialization, tooling, configuration.
### Phase 2 — Foundation
Blocking prerequisites that must exist before any user story: database schema and migrations, auth, API skeleton, error handling, environment configuration.
### Phase 3 — <User Story 1 title> (MVP)
### Phase 4 — <User Story 2 title>
Continue one phase per user story, in priority order, each with the tasks to implement it and an **Independent test:** line.
### Final Phase — Polish & Cross-Cutting
Security hardening, performance, accessibility, documentation.

### Dependencies & Execution Order
Which phases block which, and where parallelism is available.

### MVP Definition
The smallest set of phases that produces a usable product.

${languageRule(language)}`,
    }),
  },
];

export function stageById(id: string): StageSpec | undefined {
  return STAGES.find((s) => s.id === id);
}

export function stripFences(text: string): string {
  const trimmed = text.trim();
  const match = trimmed.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/);
  return (match ? match[1] : trimmed).trim();
}

export function extractTitle(discovery: string, idea: string): string {
  const name = discovery.match(/\*\*Name:\*\*\s*(.+)/i)?.[1]?.trim();
  if (name) return name.replace(/[*_`#]/g, "").trim();
  const heading = discovery.match(/^#{2,3}\s+(.+)$/m)?.[1]?.trim();
  if (heading) return heading.replace(/[*_`#]/g, "").trim();
  return idea.split(/\s+/).slice(0, 8).join(" ");
}

const HEADER_ROLES: RoleId[] = [
  "reasoning",
  "writer",
  "architect",
  "contracts",
  "tasks",
];

export function assembleDocument(opts: {
  title: string;
  profile: ProfileId | "";
  models: Record<string, string>;
  createdAt: string;
  sections: Array<{ label: string; body: string }>;
}): string {
  const { title, profile, models, createdAt, sections } = opts;

  const provenance: string[] = [];
  if (profile) provenance.push(`Profile: **${PROFILE_LABELS[profile]}**`);
  for (const role of HEADER_ROLES) {
    const model = models[role];
    if (model) provenance.push(`${ROLE_SHORT_LABELS[role]}: \`${model}\``);
  }
  const toc = sections
    .map((s, i) => {
      const anchor = `${i + 1}-${s.label
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")}`;
      return `${i + 1}. [${s.label}](#${anchor})`;
    })
    .join("\n");

  const body = sections
    .map((s, i) => `## ${i + 1}. ${s.label}\n\n${s.body}`)
    .join("\n\n---\n\n");

  const provenanceLine = provenance.length
    ? `> ${provenance.join(" · ")}\n> Generated: ${createdAt}`
    : `> Generated: ${createdAt}`;

  return `# ${title}

> Product requirements generated from a high-level idea.
${provenanceLine}

## Contents

${toc}

---

${body}
`;
}
