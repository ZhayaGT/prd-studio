export interface ModelView {
  id: string;
  label: string;
  contextLimit: number | null;
  maxOutput: number | null;
  supportsCache: boolean;
  reasoningLevels: string[];
  pricing: { inPerMtok: number; outPerMtok: number; origin: string } | null;
}

export interface ProfileView {
  id: string;
  label: string;
  blurb: string;
}

export interface SettingsView {
  hasApiKey: boolean;
  apiKeyMasked: string;
  baseUrl: string;
  profile: string;
  roles: Record<string, { primary: string; fallbacks: string[] }>;
  bidCaps: { maxInputPrice: number; maxOutputPrice: number };
}

export interface SettingsPayload {
  settings: SettingsView;
  profiles: ProfileView[];
  spend: { all: number; last30: number };
}

export interface ModelsPayload {
  models: ModelView[];
  updatedAt: string | null;
  count: number;
  error?: string;
}
