import { FALLBACK_PRICES } from "./prices";
import { getApiKey, getBaseUrl } from "./settings";
import { replaceModels, type ModelRow } from "./store";
import type { BidCaps } from "./types";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface ChatResult {
  text: string;
  reasoning: string;
  model: string;
  chainIndex: number;
  finishReason: string;
  usage: Usage;
  ms: number;
}

export class InferHubError extends Error {
  status: number | null;
  code: string | null;

  constructor(message: string, status: number | null = null, code: string | null = null) {
    super(message);
    this.name = "InferHubError";
    this.status = status;
    this.code = code;
  }
}

export interface ChatOptions {
  chain: string[];
  bidCaps: BidCaps;
  messages: ChatMessage[];
  maxOutputTokens: number;
  temperature?: number;
  json?: boolean;
  signal?: AbortSignal;
  onDelta?: (text: string) => void;
}

const RETRYABLE_STATUS = new Set([408, 409, 429, 500, 502, 503, 504]);
const RETRYABLE_CODE: Record<string, true> = {
  no_capacity: true,
  upstream_chain_exhausted: true,
};
const RETRY_DELAY_MS = 700;

export function isAbortError(error: unknown): boolean {
  return (
    (error instanceof Error && error.name === "AbortError") ||
    (typeof error === "object" &&
      error !== null &&
      (error as { name?: string }).name === "AbortError")
  );
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  if (signal?.aborted) {
    reject(new DOMException("Aborted", "AbortError"));
    return promise;
  }
  const onAbort = () => {
    clearTimeout(timer);
    reject(new DOMException("Aborted", "AbortError"));
  };
  const timer = setTimeout(() => {
    signal?.removeEventListener("abort", onAbort);
    resolve();
  }, ms);
  signal?.addEventListener("abort", onAbort, { once: true });
  return promise;
}

interface ErrorBody {
  status: number;
  message: string;
  code: string | null;
}

async function readError(res: Response): Promise<ErrorBody> {
  let message = `HTTP ${res.status}`;
  let code: string | null = null;
  try {
    const text = await res.text();
    const json = JSON.parse(text) as {
      error?: { message?: string; code?: string; type?: string } | string;
      message?: string;
      code?: string;
    };
    if (typeof json.error === "string") message = json.error;
    else if (json.error?.message) message = json.error.message;
    else if (json.message) message = json.message;
    code = json.error && typeof json.error === "object" ? (json.error.code ?? null) : null;
    code = code ?? json.code ?? null;
  } catch {
    /* keep the status message */
  }
  return { status: res.status, message, code };
}

/** Adjusts the request body for parameters the model rejects. */
function negotiate(
  body: Record<string, unknown>,
  message: string,
  adjusted: Set<string>,
): boolean {
  const lower = message.toLowerCase();
  if (!adjusted.has("temperature") && "temperature" in body && lower.includes("temperature")) {
    delete body.temperature;
    adjusted.add("temperature");
    return true;
  }
  if (
    !adjusted.has("max_tokens") &&
    "max_tokens" in body &&
    (lower.includes("max_tokens") || lower.includes("max tokens") || lower.includes("max_completion_tokens"))
  ) {
    body.max_completion_tokens = body.max_tokens;
    delete body.max_tokens;
    adjusted.add("max_tokens");
    return true;
  }
  if (
    !adjusted.has("response_format") &&
    "response_format" in body &&
    (lower.includes("response_format") || lower.includes("response format"))
  ) {
    delete body.response_format;
    adjusted.add("response_format");
    return true;
  }
  return false;
}

interface StreamState {
  text: string;
  reasoning: string;
  finishReason: string;
  usage: Usage;
}

async function readStream(
  res: Response,
  onDelta?: (text: string) => void,
): Promise<StreamState> {
  const state: StreamState = {
    text: "",
    reasoning: "",
    finishReason: "",
    usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
  };
  if (!res.body) throw new InferHubError("Empty response stream", res.status);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      let chunk: {
        error?: { code?: string; message?: string } | string;
        choices?: Array<{
          delta?: { content?: string | null; reasoning_content?: string | null };
          finish_reason?: string | null;
        }>;
        usage?: {
          prompt_tokens?: number;
          completion_tokens?: number;
          cost?: number;
        } | null;
      };
      try {
        chunk = JSON.parse(payload);
      } catch {
        continue;
      }
      // The upstream reports provider failures in-band on a 200 stream.
      if (chunk.error) {
        const error = chunk.error;
        await reader.cancel().catch(() => {});
        throw new InferHubError(
          typeof error === "string" ? error : (error.message ?? "Upstream stream error"),
          res.status,
          typeof error === "string" ? null : (error.code ?? null),
        );
      }
      const choice = chunk.choices?.[0];
      const delta = choice?.delta?.content;
      if (typeof delta === "string" && delta.length > 0) {
        state.text += delta;
        onDelta?.(delta);
      }
      const reasoning = choice?.delta?.reasoning_content;
      if (typeof reasoning === "string" && reasoning.length > 0) {
        state.reasoning += reasoning;
      }
      if (choice?.finish_reason) state.finishReason = choice.finish_reason;
      if (chunk.usage) {
        state.usage = {
          inputTokens: chunk.usage.prompt_tokens ?? 0,
          outputTokens: chunk.usage.completion_tokens ?? 0,
          costUsd: chunk.usage.cost ?? 0,
        };
      }
    }
  }
  return state;
}

async function requestOnce(
  model: string,
  opts: ChatOptions,
): Promise<{ text: string; reasoning: string; finishReason: string; usage: Usage }> {
  const baseUrl = getBaseUrl();
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new InferHubError(
      "No InferHub API key. Add one in Settings or set INFERHUB_API_KEY.",
    );
  }

  const body: Record<string, unknown> = {
    model,
    messages: opts.messages,
    max_tokens: opts.maxOutputTokens,
  };
  if (opts.temperature !== undefined) body.temperature = opts.temperature;
  if (opts.json) body.response_format = { type: "json_object" };
  if (opts.onDelta) {
    body.stream = true;
    body.stream_options = { include_usage: true };
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
  if (opts.bidCaps.maxInputPrice > 0) {
    headers["x-max-input-price"] = String(opts.bidCaps.maxInputPrice);
  }
  if (opts.bidCaps.maxOutputPrice > 0) {
    headers["x-max-output-price"] = String(opts.bidCaps.maxOutputPrice);
  }

  const adjusted = new Set<string>();
  for (let attempt = 0; ; attempt += 1) {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: opts.signal,
      cache: "no-store",
    });

    if (res.ok) {
      if (opts.onDelta) {
        const stream = await readStream(res, opts.onDelta);
        return stream;
      }
      const json = (await res.json()) as {
        choices?: Array<{
          message?: { content?: string | null; reasoning_content?: string | null };
          finish_reason?: string | null;
        }>;
        usage?: {
          prompt_tokens?: number;
          completion_tokens?: number;
          cost?: number;
        } | null;
      };
      const choice = json.choices?.[0];
      return {
        text: choice?.message?.content ?? "",
        reasoning: choice?.message?.reasoning_content ?? "",
        finishReason: choice?.finish_reason ?? "",
        usage: {
          inputTokens: json.usage?.prompt_tokens ?? 0,
          outputTokens: json.usage?.completion_tokens ?? 0,
          costUsd: json.usage?.cost ?? 0,
        },
      };
    }

    const error = await readError(res);
    if (error.status === 400 && attempt < 2 && negotiate(body, error.message, adjusted)) {
      continue;
    }
    throw new InferHubError(error.message, error.status, error.code);
  }
}

/**
 * Runs one call down the role's model chain. A 402 means no provider sits under
 * the bid cap: move on rather than silently paying more.
 */
export async function chat(opts: ChatOptions): Promise<ChatResult> {
  const tried: string[] = [];
  let lastError: unknown = null;

  for (let index = 0; index < opts.chain.length; index += 1) {
    const model = opts.chain[index];
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const attemptStart = Date.now();
      try {
        const result = await requestOnce(model, opts);
        // A reasoning model can spend the whole budget on its thinking trace and
        // return no content. Treat that as this model failing, not the stage.
        if (!result.text.trim()) {
          throw new InferHubError(
            `Empty reply from ${model} (finishReason: ${result.finishReason || "unknown"})`,
            null,
            "empty_reply",
          );
        }
        return {
          text: result.text,
          reasoning: result.reasoning,
          model,
          chainIndex: index,
          finishReason: result.finishReason,
          usage: result.usage,
          ms: Date.now() - attemptStart,
        };
      } catch (error) {
        if (isAbortError(error)) throw error;
        lastError = error;
        tried.push(model);
        // 402 and `no_provider_under_bid` mean no provider sits under the cap:
        // move on instead of paying more or retrying the same model.
        if (
          error instanceof InferHubError &&
          (error.status === 402 || error.code === "no_provider_under_bid")
        ) {
          break;
        }
        const message = error instanceof Error ? error.message.toLowerCase() : "";
        // An empty reply means the model itself is unusable here; another
        // attempt at the same model only burns the same budget again.
        if (error instanceof InferHubError && error.code === "empty_reply") break;
        const retryable =
          !(error instanceof InferHubError) ||
          error.status === null ||
          RETRYABLE_STATUS.has(error.status) ||
          (error.code !== null && Boolean(RETRYABLE_CODE[error.code])) ||
          message.includes("no_capacity") ||
          message.includes("upstream_chain_exhausted");
        if (!retryable || attempt === 1) break;
        await sleep(RETRY_DELAY_MS, opts.signal);
      }
    }
  }

  const cap = opts.bidCaps;
  const detail =
    lastError instanceof Error ? lastError.message : "Unknown error";
  throw new InferHubError(
    `All models failed (${[...new Set(tried)].join(", ")}); bid caps in=${cap.maxInputPrice} out=${cap.maxOutputPrice}. Last error: ${detail}`,
    lastError instanceof InferHubError ? lastError.status : null,
    lastError instanceof InferHubError ? lastError.code : null,
  );
}

interface CatalogEntry {
  id?: unknown;
  modality?: unknown;
  pricing?: {
    min_ask_in?: unknown;
    min_ask_out?: unknown;
  } | null;
  input_token_limit?: unknown;
  max_output_tokens?: unknown;
  supports_cache?: unknown;
  reasoning_levels?: unknown;
  upstream_label?: unknown;
  owned_by?: unknown;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export async function fetchCatalog(): Promise<{ count: number }> {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new InferHubError(
      "No InferHub API key. Add one in Settings or set INFERHUB_API_KEY.",
    );
  }
  const res = await fetch(`${getBaseUrl()}/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    cache: "no-store",
  });
  if (!res.ok) {
    const error = await readError(res);
    throw new InferHubError(error.message, error.status, error.code);
  }
  const json = (await res.json()) as { data?: CatalogEntry[] };
  const now = new Date().toISOString();
  const rows: ModelRow[] = [];

  for (const entry of json.data ?? []) {
    const id = typeof entry.id === "string" ? entry.id : "";
    if (!id || id.endsWith("/")) continue;
    const modality = typeof entry.modality === "string" ? entry.modality : "";
    if (modality && !modality.includes("text")) continue;

    const inPrice = numberOrNull(entry.pricing?.min_ask_in);
    const outPrice = numberOrNull(entry.pricing?.min_ask_out);
    const fallback = FALLBACK_PRICES[id] ?? FALLBACK_PRICES[id.split("/").slice(1).join("/")];
    const pricingKnown = inPrice !== null || outPrice !== null || Boolean(fallback);
    const slash = id.indexOf("/");
    const levels = Array.isArray(entry.reasoning_levels)
      ? entry.reasoning_levels.filter((l): l is string => typeof l === "string")
      : [];

    rows.push({
      id,
      label:
        typeof entry.upstream_label === "string" && entry.upstream_label
          ? entry.upstream_label
          : id,
      publisher:
        typeof entry.owned_by === "string" && entry.owned_by
          ? entry.owned_by
          : slash > 0
            ? id.slice(0, slash)
            : "auto",
      modality,
      context_limit: numberOrNull(entry.input_token_limit),
      max_output: numberOrNull(entry.max_output_tokens),
      supports_cache: entry.supports_cache === true ? 1 : 0,
      reasoning_levels: JSON.stringify(levels),
      in_per_mtok: inPrice ?? fallback?.[0] ?? null,
      out_per_mtok: outPrice ?? fallback?.[1] ?? null,
      price_origin: pricingKnown ? "catalog" : "fallback",
      updated_at: now,
    });
  }

  replaceModels(rows);
  return { count: rows.length };
}
