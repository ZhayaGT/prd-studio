import { analyzeClarity } from "@/lib/clarification";
import { getSettings, resolveRunRoles } from "@/lib/settings";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: Request) {
  let payload: { idea?: string; language?: string; profile?: string };
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
  const { roles } = resolveRunRoles(settings, payload.profile);

  try {
    const result = await analyzeClarity({
      idea,
      language,
      roles,
      bidCaps: settings.bidCaps,
      signal: req.signal,
    });
    return Response.json(result);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return Response.json({ error: "Cancelled" }, { status: 499 });
    }
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Clarity analysis failed",
      },
      { status: 502 },
    );
  }
}
