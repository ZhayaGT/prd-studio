import { z } from "zod";
import { fetchCatalog } from "@/lib/inferhub";
import { PROFILES } from "@/lib/profiles";
import { getSettings, publicSettings, updateSettings } from "@/lib/settings";
import { totalSpendUsd } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const roleSchema = z.object({
  primary: z.string(),
  fallbacks: z.array(z.string()).max(8),
});

const patchSchema = z.object({
  apiKey: z.string().optional(),
  baseUrl: z.string().optional(),
  profile: z.enum(["hemat", "combo", "maksimal"]).optional(),
  roles: z.record(z.string(), roleSchema).optional(),
  bidCaps: z
    .object({
      maxInputPrice: z.number().optional(),
      maxOutputPrice: z.number().optional(),
    })
    .optional(),
  test: z.boolean().optional(),
  refreshCatalog: z.boolean().optional(),
});

export async function GET() {
  const settings = getSettings();
  return Response.json({
    settings: publicSettings(settings),
    profiles: PROFILES.map((p) => ({ id: p.id, label: p.label, blurb: p.blurb })),
    spend: totalSpendUsd(),
  });
}

export async function POST(req: Request) {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = patchSchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues.map((i) => i.message).join("; ") },
      { status: 400 },
    );
  }

  const { test, refreshCatalog, ...patch } = parsed.data;
  const settings = updateSettings(patch);

  const body: Record<string, unknown> = {
    settings: publicSettings(settings),
    profiles: PROFILES.map((p) => ({ id: p.id, label: p.label, blurb: p.blurb })),
    spend: totalSpendUsd(),
  };

  if (test || refreshCatalog) {
    try {
      const result = await fetchCatalog();
      body.catalog = { count: result.count };
      if (test) body.test = { ok: true, count: result.count };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Catalog refresh failed";
      body.catalogError = message;
      if (test) body.test = { ok: false, error: message };
    }
  }

  return Response.json(body);
}
