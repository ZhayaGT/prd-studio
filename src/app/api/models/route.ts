import { fetchCatalog } from "@/lib/inferhub";
import { FALLBACK_PRICES } from "@/lib/prices";
import { listModelRows, modelsUpdatedAt, seedFallbackPrices, type ModelRow } from "@/lib/store";
import type { ModelInfo } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function toInfo(row: ModelRow): ModelInfo {
  const inPrice = row.in_per_mtok;
  const outPrice = row.out_per_mtok;
  let levels: string[] = [];
  try {
    const parsed = JSON.parse(row.reasoning_levels) as unknown;
    if (Array.isArray(parsed)) {
      levels = parsed.filter((v): v is string => typeof v === "string");
    }
  } catch {
    levels = [];
  }
  return {
    id: row.id,
    label: row.label,
    publisher: row.publisher,
    modality: row.modality,
    contextLimit: row.context_limit,
    maxOutput: row.max_output,
    supportsCache: row.supports_cache === 1,
    reasoningLevels: levels,
    pricing:
      inPrice === null && outPrice === null
        ? null
        : {
            inPerMtok: inPrice ?? 0,
            outPerMtok: outPrice ?? 0,
            origin: row.price_origin === "catalog" ? "catalog" : "fallback",
          },
  };
}

function payload(error?: string) {
  const rows = listModelRows();
  return {
    models: rows.map(toInfo),
    updatedAt: modelsUpdatedAt(),
    count: rows.length,
    ...(error ? { error } : {}),
  };
}

export async function GET() {
  seedFallbackPrices(FALLBACK_PRICES);
  // The fallback seed alone leaves prefixed ids unpriced and absent; only a
  // catalog row marks the table as loaded.
  if (modelsUpdatedAt() === null) {
    try {
      await fetchCatalog();
    } catch (error) {
      // Settings must still render with the seeded fallback rows.
      return Response.json(
        payload(error instanceof Error ? error.message : "Catalog refresh failed"),
      );
    }
  }
  return Response.json(payload());
}

export async function POST() {
  seedFallbackPrices(FALLBACK_PRICES);
  try {
    await fetchCatalog();
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Catalog refresh failed",
        ...payload(),
      },
      { status: 502 },
    );
  }
  return Response.json(payload());
}
