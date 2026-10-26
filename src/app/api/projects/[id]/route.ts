import { assembleFromStages, titleFromStages } from "@/lib/pipeline";
import { deleteProject, getProject, updateProject } from "@/lib/store";
import type { StageId } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_STAGES: StageId[] = [
  "discovery",
  "prd",
  "architecture",
  "dataApi",
  "tasks",
];

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const project = getProject(id);
  if (!project) {
    return Response.json({ error: "Project not found" }, { status: 404 });
  }
  return Response.json({ project });
}

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const existing = getProject(id);
  if (!existing) {
    return Response.json({ error: "Project not found" }, { status: 404 });
  }

  let payload: { stages?: Record<string, string> };
  try {
    payload = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const incoming = payload.stages;
  if (!incoming || typeof incoming !== "object") {
    return Response.json(
      { error: "Body must contain a stages object" },
      { status: 400 },
    );
  }

  const stages = { ...existing.stages };
  for (const [key, value] of Object.entries(incoming)) {
    if (!VALID_STAGES.includes(key as StageId)) {
      return Response.json(
        { error: `Unknown stage: ${key}` },
        { status: 400 },
      );
    }
    if (typeof value !== "string") {
      return Response.json(
        { error: `Stage ${key} must be a string` },
        { status: 400 },
      );
    }
    stages[key as StageId] = value;
  }

  const title = titleFromStages(stages, existing.idea);
  const content = assembleFromStages({
    title,
    profile: existing.profile,
    models: existing.models,
    createdAt: existing.createdAt,
    stages,
  });

  const project = updateProject(id, { title, content, stages });
  if (!project) {
    return Response.json({ error: "Project not found" }, { status: 404 });
  }
  return Response.json({ project });
}

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const removed = deleteProject(id);
  if (!removed) {
    return Response.json({ error: "Project not found" }, { status: 404 });
  }
  return Response.json({ ok: true });
}
