export type StageId = "discovery" | "prd" | "architecture" | "dataApi" | "tasks";

export type RoleId =
  | "intake"
  | "reasoning"
  | "writer"
  | "architect"
  | "contracts"
  | "tasks";

export type ProfileId = "hemat" | "combo" | "maksimal";

export interface RoleModels {
  primary: string;
  fallbacks: string[];
}

export type RoleModelMap = Record<RoleId, RoleModels>;

export interface BidCaps {
  maxInputPrice: number;
  maxOutputPrice: number;
}

export interface ProfileDef {
  id: ProfileId;
  label: string;
  blurb: string;
  roles: RoleModelMap;
}

export interface StageSpec {
  id: StageId;
  role: RoleId;
  label: string;
  blurb: string;
  maxOutputTokens: number;
  build: (ctx: StageContext) => { system: string; prompt: string };
}

export type QuestionType = "single" | "multiple" | "text";

export interface ClarifyOption {
  value: string;
  label: string;
  description?: string;
}

export interface ClarifyQuestion {
  id: string;
  category: string;
  question: string;
  reason: string;
  required: boolean;
  type: QuestionType;
  options?: ClarifyOption[];
  recommendedOption?: string;
}

export interface ClarifyResult {
  status: "clear" | "needs_clarification";
  summary: string;
  questions: ClarifyQuestion[];
  assumptions: string[];
}

export interface BriefAnswer {
  id: string;
  question: string;
  answer: string;
  skipped: boolean;
}

export interface BriefContext {
  summary: string;
  answers: BriefAnswer[];
  assumptions: string[];
}

export interface StageContext {
  idea: string;
  language: string;
  preset?: string;
  brief?: BriefContext;
  discovery?: string;
  prd?: string;
  architecture?: string;
  dataApi?: string;
}

export interface ProjectSummary {
  id: string;
  title: string;
  idea: string;
  profile: ProfileId | "";
  language: string;
  preset: string;
  costUsd: number;
  createdAt: string;
}

export interface ProjectRecord extends ProjectSummary {
  content: string;
  stages: Partial<Record<StageId, string>>;
  brief: BriefContext | null;
  models: Record<string, string>;
}

export type PipelineEvent =
  | {
      type: "stage_start";
      id: StageId;
      label: string;
      role: RoleId;
      model: string;
    }
  | { type: "delta"; id: StageId; text: string }
  | {
      type: "stage_end";
      id: StageId;
      truncated: boolean;
      model: string;
      fallback: boolean;
      inputTokens: number;
      outputTokens: number;
      costUsd: number;
      ms: number;
    }
  | { type: "cost"; totalUsd: number }
  | { type: "done"; project: ProjectSummary }
  | { type: "error"; message: string };

export interface ModelPricing {
  inPerMtok: number;
  outPerMtok: number;
  origin: "catalog" | "fallback";
}

export interface ModelInfo {
  id: string;
  label: string;
  publisher: string;
  modality: string;
  contextLimit: number | null;
  maxOutput: number | null;
  supportsCache: boolean;
  reasoningLevels: string[];
  pricing: ModelPricing | null;
}

export interface Settings {
  hasApiKey: boolean;
  apiKeyMasked: string;
  baseUrl: string;
  profile: ProfileId;
  roles: RoleModelMap;
  bidCaps: BidCaps;
}

/** Raw role map accepted from the client before validation and trimming. */
export type RolePatch = Record<string, { primary: string; fallbacks: string[] }>;

export interface SettingsPatch {
  apiKey?: string;
  baseUrl?: string;
  profile?: ProfileId;
  roles?: RolePatch;
  bidCaps?: Partial<BidCaps>;
}
