import { chat, isAbortError, type ChatMessage } from "./inferhub";
import { roleChain } from "./profiles";
import { logUsage } from "./store";
import type { BidCaps, RoleId, RoleModelMap, StageId } from "./types";

export interface RunContext {
  projectId: string | null;
  roles: RoleModelMap;
  bidCaps: BidCaps;
  models: Record<string, string>;
  costUsd: number;
  signal?: AbortSignal;
}

export interface RoleCallOutcome {
  text: string;
  reasoning: string;
  model: string;
  requestedModel: string;
  fallback: boolean;
  finishReason: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  ms: number;
}

export interface RoleCallOptions {
  stage: StageId | "clarify";
  role: RoleId;
  messages: ChatMessage[];
  maxOutputTokens: number;
  temperature?: number;
  json?: boolean;
  onDelta?: (text: string) => void;
}

/** The single place that records which model actually served a stage. */
export async function callRole(
  ctx: RunContext,
  opts: RoleCallOptions,
): Promise<RoleCallOutcome> {
  const chain = roleChain(ctx.roles, opts.role);
  if (chain.length === 0) {
    throw new Error(`No model configured for role ${opts.role}.`);
  }

  try {
    const result = await chat({
      chain,
      bidCaps: ctx.bidCaps,
      messages: opts.messages,
      maxOutputTokens: opts.maxOutputTokens,
      temperature: opts.temperature,
      json: opts.json,
      signal: ctx.signal,
      onDelta: opts.onDelta,
    });

    const outcome: RoleCallOutcome = {
      text: result.text,
      reasoning: result.reasoning,
      model: result.model,
      requestedModel: chain[0],
      fallback: result.chainIndex > 0,
      finishReason: result.finishReason,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      costUsd: result.usage.costUsd,
      ms: result.ms,
    };

    ctx.models[opts.role] = result.model;
    ctx.costUsd += result.usage.costUsd;

    logUsage({
      projectId: ctx.projectId,
      stage: opts.stage,
      role: opts.role,
      model: result.model,
      requestedModel: chain[0],
      fallback: result.chainIndex > 0,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      costUsd: result.usage.costUsd,
      ms: result.ms,
      status: "ok",
    });

    return outcome;
  } catch (error) {
    // A user pressing Stop is not a failed call: no spend, no error row.
    if (isAbortError(error)) throw error;
    logUsage({
      projectId: ctx.projectId,
      stage: opts.stage,
      role: opts.role,
      model: chain[0],
      requestedModel: chain[0],
      fallback: false,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      ms: 0,
      status: "error",
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Streams deltas from `callRole` while returning the final outcome. An early
 * consumer return must not surface as an unhandled rejection.
 */
export async function* streamRole(
  ctx: RunContext,
  opts: Omit<RoleCallOptions, "onDelta">,
): AsyncGenerator<{ type: "delta"; text: string }, RoleCallOutcome> {
  const items: string[] = [];
  let wake: (() => void) | null = null;
  const promise = callRole(ctx, {
    ...opts,
    onDelta: (text) => {
      items.push(text);
      wake?.();
      wake = null;
    },
  });
  promise.catch(() => {});

  for (;;) {
    while (items.length > 0) yield { type: "delta" as const, text: items.shift()! };
    const idle = Promise.withResolvers<{ done: false }>();
    wake = () => idle.resolve({ done: false });
    // Settle on failure too: a rejected call with no further deltas would
    // otherwise leave this generator waiting forever.
    const settled = await Promise.race([
      promise.then(
        (r) => ({ done: true as const, ok: true as const, r }),
        (e: unknown) => ({ done: true as const, ok: false as const, e }),
      ),
      idle.promise,
    ]);
    if (settled.done) {
      while (items.length > 0) yield { type: "delta" as const, text: items.shift()! };
      if (!settled.ok) throw settled.e;
      return settled.r;
    }
  }
}
