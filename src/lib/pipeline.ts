import { randomUUID } from "node:crypto";
import {
  STAGES,
  assembleDocument,
  buildStagePrompt,
  extractTitle,
  stageById,
  stripFences,
} from "./prompts";
import { streamRole, type RunContext } from "./rolecall";
import { roleChain } from "./profiles";
import { saveProject, updateProject, getProjectSummary } from "./store";
import type {
  BidCaps,
  BriefContext,
  PipelineEvent,
  ProfileId,
  ProjectSummary,
  RoleModelMap,
  StageContext,
  StageId,
  StageSpec,
} from "./types";

async function* streamStage(opts: {
  stage: StageSpec;
  ctx: StageContext;
  run: RunContext;
}): AsyncGenerator<PipelineEvent, string> {
  const { stage, ctx, run } = opts;
  const chain = roleChain(run.roles, stage.role);
  yield {
    type: "stage_start",
    id: stage.id,
    label: stage.label,
    role: stage.role,
    model: chain[0] ?? "",
  };

  const { system, prompt } = buildStagePrompt(stage, ctx);
  const deltas = streamRole(run, {
    stage: stage.id,
    role: stage.role,
    messages: [
      { role: "system", content: system },
      { role: "user", content: prompt },
    ],
    maxOutputTokens: stage.maxOutputTokens,
    temperature: 0.3,
  });

  let next = await deltas.next();
  while (!next.done) {
    yield { type: "delta", id: stage.id, text: next.value.text };
    next = await deltas.next();
  }
  const outcome = next.value;

  yield {
    type: "stage_end",
    id: stage.id,
    truncated: outcome.finishReason === "length",
    model: outcome.model,
    fallback: outcome.fallback,
    inputTokens: outcome.inputTokens,
    outputTokens: outcome.outputTokens,
    costUsd: outcome.costUsd,
    ms: outcome.ms,
  };

  if (!outcome.text.trim()) {
    throw new Error(
      `Empty reply from ${outcome.model} for ${stage.id} (finishReason: ${
        outcome.finishReason || "unknown"
      }). Raise the output budget or pick another ${stage.role} model in Settings.`,
    );
  }

  return stripFences(outcome.text);
}

export function assembleFromStages(opts: {
  title: string;
  profile: ProfileId | "";
  models: Record<string, string>;
  createdAt: string;
  stages: Partial<Record<StageId, string>>;
}): string {
  return assembleDocument({
    title: opts.title,
    profile: opts.profile,
    models: opts.models,
    createdAt: opts.createdAt,
    sections: STAGES.map((s) => ({
      label: s.label,
      body: opts.stages[s.id] ?? "",
    })),
  });
}

export function titleFromStages(
  stages: Partial<Record<StageId, string>>,
  idea: string,
): string {
  return extractTitle(stages.discovery ?? "", idea);
}

export async function* runPipeline(opts: {
  idea: string;
  profile: ProfileId;
  roles: RoleModelMap;
  bidCaps: BidCaps;
  language: string;
  preset?: string;
  brief?: BriefContext | null;
  signal?: AbortSignal;
}): AsyncGenerator<PipelineEvent> {
  const projectId = randomUUID();
  const run: RunContext = {
    projectId,
    roles: opts.roles,
    bidCaps: opts.bidCaps,
    models: {},
    costUsd: 0,
    signal: opts.signal,
  };
  const ctx: StageContext = {
    idea: opts.idea,
    language: opts.language,
    preset: opts.preset,
    brief: opts.brief ?? undefined,
  };
  const outputs: Partial<Record<StageId, string>> = {};

  for (const stage of STAGES) {
    const text = yield* streamStage({ stage, ctx, run });
    outputs[stage.id] = text;
    if (stage.id !== "tasks") ctx[stage.id] = text;
    yield { type: "cost", totalUsd: run.costUsd };
  }

  const title = titleFromStages(outputs, opts.idea);
  const createdAt = new Date().toISOString();
  const content = assembleFromStages({
    title,
    profile: opts.profile,
    models: run.models,
    createdAt,
    stages: outputs,
  });

  saveProject({
    id: projectId,
    title,
    idea: opts.idea,
    profile: opts.profile,
    models: run.models,
    language: opts.language,
    preset: opts.preset ?? "",
    createdAt,
    content,
    stages: outputs,
    brief: opts.brief ?? null,
  });

  yield { type: "done", project: summaryFor(projectId) };
}

function summaryFor(id: string): ProjectSummary {
  const summary = getProjectSummary(id);
  if (!summary) throw new Error(`Project ${id} disappeared after saving.`);
  return summary;
}

export async function* regenerateStage(opts: {
  id: string;
  stageId: StageId;
  profile: ProfileId | "";
  roles: RoleModelMap;
  bidCaps: BidCaps;
  models: Record<string, string>;
  preset?: string;
  stages: Partial<Record<StageId, string>>;
  idea: string;
  language: string;
  createdAt: string;
  brief?: BriefContext | null;
  signal?: AbortSignal;
}): AsyncGenerator<PipelineEvent, ProjectSummary | null> {
  const stage = stageById(opts.stageId);
  if (!stage) throw new Error(`Unknown stage: ${opts.stageId}`);

  const run: RunContext = {
    projectId: opts.id,
    roles: opts.roles,
    bidCaps: opts.bidCaps,
    models: { ...opts.models },
    costUsd: 0,
    signal: opts.signal,
  };

  const ctx: StageContext = {
    idea: opts.idea,
    language: opts.language,
    preset: opts.preset,
    brief: opts.brief ?? undefined,
    discovery: opts.stages.discovery,
    prd: opts.stages.prd,
    architecture: opts.stages.architecture,
    dataApi: opts.stages.dataApi,
  };

  const text = yield* streamStage({ stage, ctx, run });
  yield { type: "cost", totalUsd: run.costUsd };

  const stages: Partial<Record<StageId, string>> = {
    ...opts.stages,
    [opts.stageId]: text,
  };
  const title = titleFromStages(stages, opts.idea);
  const content = assembleFromStages({
    title,
    profile: opts.profile,
    models: run.models,
    createdAt: opts.createdAt,
    stages,
  });

  const project = updateProject(opts.id, {
    title,
    content,
    stages,
    preset: opts.preset,
    profile: opts.profile,
    models: run.models,
  });
  if (project) yield { type: "done", project };
  return project;
}
