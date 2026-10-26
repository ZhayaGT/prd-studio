import { normalizeBrief } from "@/lib/clarification";
import { runPipeline } from "@/lib/pipeline";
import { DEFAULT_PRESET } from "@/lib/presets";
import { getSettings, resolveRunRoles } from "@/lib/settings";
import type { PipelineEvent } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 800;

export async function POST(req: Request) {
  let payload: {
    idea?: string;
    language?: string;
    preset?: string;
    brief?: unknown;
    profile?: string;
  };
  try {
    payload = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const idea = (payload.idea ?? "").trim();
  if (idea.length < 10) {
    return Response.json(
      { error: "Describe your idea in at least 10 characters." },
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

  const language = payload.language?.trim() || "English";
  const preset = payload.preset?.trim() || DEFAULT_PRESET;
  const brief = normalizeBrief(payload.brief);
  const { profile, roles } = resolveRunRoles(settings, payload.profile);

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: PipelineEvent) =>
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      try {
        for await (const event of runPipeline({
          idea,
          profile,
          roles,
          bidCaps: settings.bidCaps,
          language,
          preset,
          brief,
          signal: req.signal,
        })) {
          send(event);
        }
      } catch (error) {
        send({
          type: "error",
          message: error instanceof Error ? error.message : "Generation failed",
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
