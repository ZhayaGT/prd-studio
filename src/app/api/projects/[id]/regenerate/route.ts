import { regenerateStage } from "@/lib/pipeline";
import { DEFAULT_PRESET } from "@/lib/presets";
import { getSettings, resolveRunRoles } from "@/lib/settings";
import { getProject } from "@/lib/store";
import type { PipelineEvent, StageId } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 800;

const VALID_STAGES: StageId[] = [
  "discovery",
  "prd",
  "architecture",
  "dataApi",
  "tasks",
];

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const project = getProject(id);
  if (!project) {
    return Response.json({ error: "Project not found" }, { status: 404 });
  }

  let payload: { stage?: string; preset?: string; profile?: string };
  try {
    payload = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const stageId = payload.stage as StageId | undefined;
  if (!stageId || !VALID_STAGES.includes(stageId)) {
    return Response.json(
      { error: `stage must be one of: ${VALID_STAGES.join(", ")}` },
      { status: 400 },
    );
  }

  const settings = getSettings();
  if (!settings.hasApiKey) {
    return Response.json(
      { error: "No InferHub API key. Add one in Settings." },
      { status: 400 },
    );
  }

  const preset = payload.preset?.trim() || project.preset || DEFAULT_PRESET;
  const { profile, roles } = resolveRunRoles(
    settings,
    payload.profile || project.profile,
  );

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: PipelineEvent) =>
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      try {
        for await (const event of regenerateStage({
          id,
          stageId,
          profile,
          roles,
          bidCaps: settings.bidCaps,
          models: project.models,
          preset,
          stages: project.stages,
          idea: project.idea,
          language: project.language,
          createdAt: project.createdAt,
          brief: project.brief,
          signal: req.signal,
        })) {
          send(event);
        }
      } catch (error) {
        send({
          type: "error",
          message:
            error instanceof Error ? error.message : "Regeneration failed",
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
