import { z } from "zod";
import { callRole, type RunContext } from "./rolecall";
import type {
  BidCaps,
  BriefContext,
  ClarifyResult,
  QuestionType,
  RoleModelMap,
} from "./types";

const optionSchema = z.object({
  value: z.string().catch(""),
  label: z.string().catch(""),
  description: z.string().optional().catch(undefined),
});

const questionSchema = z.object({
  id: z.string().optional().catch(undefined),
  category: z.string().optional().catch(undefined),
  question: z.string().catch(""),
  reason: z.string().optional().catch(undefined),
  required: z.boolean().optional().catch(undefined),
  type: z.enum(["single", "multiple", "text"]).catch("text"),
  options: z.array(optionSchema).optional().catch(undefined),
  recommendedOption: z.string().optional().catch(undefined),
});

const clarifySchema = z.object({
  status: z.enum(["clear", "needs_clarification"]).catch("clear"),
  summary: z.string().optional().catch(undefined),
  questions: z.array(questionSchema).optional().catch(undefined),
  assumptions: z.array(z.string()).optional().catch(undefined),
});

const SYSTEM = `You are a staff product engineer running intake for a spec-driven planning tool.

Your job is to decide whether a rough product idea contains enough information to produce an accurate product requirements document, and to ask only for what is genuinely missing.

Rules:
- Ask about something only when a wrong guess would change the product scope, the architecture, or the data model.
- Never ask for information the user already provided, even implicitly.
- Never ask generic discovery questions. "Who is the target user?" is only worth asking when the audience is truly undefined, not when the idea already names it.
- Prefer a small number of sharp questions over a complete questionnaire.
- Hard limit: five questions. Use fewer when fewer are needed. Zero is a valid and common answer.
- For every question offer two to four concrete options when the answer space is enumerable, plus free text when it is not.
- Set required=true only for the one or two decisions that would invalidate the plan if guessed wrong.
- For each question, also list the assumption you would make if the user skips it.

You must reply with a single JSON object and nothing else. No prose, no markdown fence, no commentary before or after.

JSON shape:
{
  "status": "clear" | "needs_clarification",
  "summary": string,
  "questions": [
    {
      "id": string,
      "category": string,
      "question": string,
      "reason": string,
      "required": boolean,
      "type": "single" | "multiple" | "text",
      "options": [{ "value": string, "label": string, "description": string }],
      "recommendedOption": string
    }
  ],
  "assumptions": string[]
}

Field rules:
- status: "needs_clarification" only when an unknown would change scope or architecture. Otherwise "clear".
- summary: two sentences restating what you understood the product to be.
- questions: empty array when status is "clear". Otherwise at most five, most important first.
- id: lower_snake_case, unique.
- category: short topic label such as "Target user" or "Scope".
- question: one direct question under 140 characters.
- reason: why the answer changes the plan, under 120 characters.
- type: "single" for one choice, "multiple" for several, "text" for free text.
- options: two to four entries for "single" and "multiple". Omit or use an empty array for "text".
- recommendedOption: the value of the option you would pick, when you have a view. Omit for "text".
- assumptions: the defaults you will use if the user does not answer.`;

const JSON_SHAPE_EXAMPLE = `{
  "status": "needs_clarification",
  "summary": "A tool that helps people organise their work. The audience and the core workflow are not yet defined.",
  "questions": [
    {
      "id": "primary_audience",
      "category": "Target user",
      "question": "Who is the primary user of this tool?",
      "reason": "The audience decides the entire data model and permission design.",
      "required": true,
      "type": "single",
      "options": [
        { "value": "solo", "label": "A single individual", "description": "No sharing or roles" },
        { "value": "team", "label": "A small team", "description": "Shared workspace and roles" },
        { "value": "org", "label": "A whole organisation", "description": "Departments and admin controls" }
      ],
      "recommendedOption": "team"
    }
  ],
  "assumptions": ["Assume a web app unless stated otherwise."]
}`;

function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*\n([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : trimmed;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("The model did not return a JSON object.");
  }
  return JSON.parse(candidate.slice(start, end + 1));
}

async function requestJson(ctx: RunContext, prompt: string): Promise<string> {
  const outcome = await callRole(ctx, {
    stage: "clarify",
    role: "intake",
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: prompt },
    ],
    maxOutputTokens: 3000,
    temperature: 0.2,
    json: true,
  });
  if (!outcome.text.trim()) {
    throw new Error(
      `Empty reply from ${outcome.model} for clarify (finishReason: ${
        outcome.finishReason || "unknown"
      })`,
    );
  }
  return outcome.text;
}

export async function analyzeClarity(opts: {
  idea: string;
  language: string;
  roles: RoleModelMap;
  bidCaps: BidCaps;
  signal?: AbortSignal;
}): Promise<ClarifyResult> {
  const { idea, language } = opts;
  const ctx: RunContext = {
    projectId: null,
    roles: opts.roles,
    bidCaps: opts.bidCaps,
    models: {},
    costUsd: 0,
    signal: opts.signal,
  };

  const basePrompt = `Product idea:
"""
${idea}
"""

Decide whether this is specific enough to plan against.
Write the summary, questions, and assumptions in ${language}.

If the idea is specific enough, set status to "clear", return an empty questions array, and list the assumptions you will carry forward.
If something essential is missing, set status to "needs_clarification" and ask at most five questions, most important first.

Reply with only the JSON object. Shape reference:
${JSON_SHAPE_EXAMPLE}`;

  let raw = await requestJson(ctx, basePrompt);

  let parsed = clarifySchema.safeParse(safeParseJson(raw));
  if (!parsed.success) {
    const repairPrompt = `Your previous reply was not valid for the required JSON shape.

Previous reply:
"""
${raw.slice(0, 4000)}
"""

Validation errors:
${parsed.error.issues
  .slice(0, 12)
  .map((i) => `- ${i.path.join(".") || "(root)"}: ${i.message}`)
  .join("\n")}

Return the corrected JSON object only. No prose, no markdown fence. Required shape:
${JSON_SHAPE_EXAMPLE}`;

    raw = await requestJson(ctx, repairPrompt);
    parsed = clarifySchema.safeParse(safeParseJson(raw));
  }

  if (!parsed.success) {
    throw new Error(
      "The model did not return a usable clarification result. Try again or pick another Intake model in Settings.",
    );
  }

  const object = parsed.data;
  const questions = (object.questions ?? []).slice(0, 5).map((q, index) => {
    const options = (q.options ?? [])
      .map((o) => {
        const label = o.label?.trim() || o.value?.trim() || "";
        const value =
          o.value?.trim() ||
          label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
        return { value, label, description: o.description?.trim() || undefined };
      })
      .filter((o) => o.label.length > 0 && o.value.length > 0)
      .slice(0, 4);

    const type: QuestionType =
      q.type === "text" || options.length === 0 ? "text" : q.type;

    return {
      id: q.id?.trim() || `q${index + 1}`,
      category: q.category?.trim() || "General",
      question: q.question?.trim() || "",
      reason: q.reason?.trim() || "",
      required: Boolean(q.required),
      type,
      options: type === "text" ? undefined : options,
      recommendedOption: options.some((o) => o.value === q.recommendedOption)
        ? q.recommendedOption
        : undefined,
    };
  });

  const usable = questions.filter((q) => q.question.length > 0);

  return {
    status:
      object.status === "needs_clarification" && usable.length > 0
        ? "needs_clarification"
        : "clear",
    summary: object.summary?.trim() ?? "",
    questions: usable,
    assumptions: (object.assumptions ?? []).map((a) => a.trim()).filter(Boolean),
  };
}

function safeParseJson(text: string): unknown {
  try {
    return extractJson(text);
  } catch {
    return null;
  }
}

export function normalizeBrief(input: unknown): BriefContext | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as { summary?: unknown; answers?: unknown; assumptions?: unknown };

  const answers = Array.isArray(raw.answers)
    ? raw.answers
        .filter((a): a is Record<string, unknown> => Boolean(a) && typeof a === "object")
        .map((a, index) => ({
          id: typeof a.id === "string" && a.id ? a.id : `q${index + 1}`,
          question: typeof a.question === "string" ? a.question.slice(0, 400) : "",
          answer: typeof a.answer === "string" ? a.answer.slice(0, 2000) : "",
          skipped: Boolean(a.skipped),
        }))
        .filter((a) => a.question.length > 0)
    : [];

  const assumptions = Array.isArray(raw.assumptions)
    ? raw.assumptions
        .filter((a): a is string => typeof a === "string")
        .map((a) => a.slice(0, 400))
    : [];

  const summary = typeof raw.summary === "string" ? raw.summary.slice(0, 2000) : "";

  if (!summary && answers.length === 0 && assumptions.length === 0) return null;
  return { summary, answers, assumptions };
}

export function briefBlock(brief?: BriefContext | null): string {
  if (!brief) return "";

  const parts: string[] = [];
  if (brief.summary) {
    parts.push(`What this product is understood to be:\n${brief.summary}`);
  }

  const answered = brief.answers.filter((a) => !a.skipped && a.answer.trim());
  if (answered.length) {
    parts.push(
      `Confirmed decisions from the user (treat as requirements, not guesses):\n${answered
        .map((a) => `- ${a.question}\n  Decision: ${a.answer}`)
        .join("\n")}`,
    );
  }

  const skipped = brief.answers.filter((a) => a.skipped);
  if (skipped.length) {
    parts.push(
      `Questions the user chose not to answer (resolve with a clearly tagged [ASSUMPTION: ...]):\n${skipped
        .map((a) => `- ${a.question}`)
        .join("\n")}`,
    );
  }

  if (brief.assumptions.length) {
    parts.push(
      `Carry-forward assumptions:\n${brief.assumptions
        .map((a) => `- ${a}`)
        .join("\n")}`,
    );
  }

  if (!parts.length) return "";
  return `Established brief context (authoritative, supersedes your own defaults):\n\n${parts.join(
    "\n\n",
  )}`;
}
