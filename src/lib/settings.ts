import {
  DEFAULT_BID_CAPS,
  DEFAULT_PROFILE,
  isProfileId,
  resolveProfile,
} from "./profiles";
import { readAllSettings, writeSetting } from "./store";
import { ROLE_IDS } from "./labels";
import type {
  BidCaps,
  ProfileId,
  RoleModelMap,
  RolePatch,
  Settings,
  SettingsPatch,
} from "./types";

const DEFAULT_BASE_URL = "https://api.inferhub.dev/v1";

export function getApiKey(): string {
  const stored = readAllSettings().api_key?.trim() ?? "";
  return stored || (process.env.INFERHUB_API_KEY ?? "").trim();
}

export function getBaseUrl(): string {
  const stored = readAllSettings().base_url?.trim() ?? "";
  const value = stored || process.env.INFERHUB_BASE_URL || DEFAULT_BASE_URL;
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

export function maskKey(key: string): string {
  if (!key) return "";
  if (key.length > 12) return `${key.slice(0, 8)}…${key.slice(-4)}`;
  return `${key.slice(0, 4)}…`;
}

export function sanitizeRoles(input: RolePatch): RoleModelMap {
  const out = {} as RoleModelMap;
  for (const role of ROLE_IDS) {
    const raw = input[role];
    if (!raw) continue;
    const primary = (raw.primary ?? "").trim();
    if (!primary) continue;
    const fallbacks: string[] = [];
    for (const value of raw.fallbacks ?? []) {
      const id = (value ?? "").trim();
      if (!id || id === primary || fallbacks.includes(id)) continue;
      fallbacks.push(id);
      if (fallbacks.length === 3) break;
    }
    out[role] = { primary, fallbacks };
  }
  return out;
}

function parseJson(raw: string | undefined): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Stored roles win, but any role the store does not define falls back to the
 * profile defaults so a new role never arrives empty.
 */
function readRoles(raw: string | undefined, profile: ProfileId): RoleModelMap {
  const defaults = resolveProfile(profile).roles;
  const parsed = parseJson(raw);
  const sanitized = sanitizeRoles(
    parsed && typeof parsed === "object"
      ? (parsed as Record<string, { primary: string; fallbacks: string[] }>)
      : {},
  );
  const out = {} as RoleModelMap;
  for (const role of ROLE_IDS) {
    out[role] = sanitized[role]
      ? { primary: sanitized[role].primary, fallbacks: [...sanitized[role].fallbacks] }
      : { primary: defaults[role].primary, fallbacks: [...defaults[role].fallbacks] };
  }
  return out;
}

function readBidCaps(raw: string | undefined): BidCaps {
  const parsed = parseJson(raw) as Partial<BidCaps> | null;
  const pick = (value: unknown, fallback: number) =>
    typeof value === "number" && Number.isFinite(value)
      ? Math.max(0, value)
      : fallback;
  return {
    maxInputPrice: pick(parsed?.maxInputPrice, DEFAULT_BID_CAPS.maxInputPrice),
    maxOutputPrice: pick(parsed?.maxOutputPrice, DEFAULT_BID_CAPS.maxOutputPrice),
  };
}

export function getSettings(): Settings {
  const stored = readAllSettings();
  const profile = isProfileId(stored.profile) ? stored.profile : DEFAULT_PROFILE;
  const apiKey = getApiKey();
  return {
    hasApiKey: apiKey.length > 0,
    apiKeyMasked: maskKey(apiKey),
    baseUrl: getBaseUrl(),
    profile,
    roles: readRoles(stored.roles, profile),
    bidCaps: readBidCaps(stored.bid_caps),
  };
}

export function updateSettings(patch: SettingsPatch): Settings {
  if (patch.profile !== undefined) {
    writeSetting("profile", patch.profile);
    writeSetting(
      "roles",
      JSON.stringify(resolveProfile(patch.profile).roles),
    );
  }
  if (patch.roles !== undefined) {
    writeSetting("roles", JSON.stringify(sanitizeRoles(patch.roles)));
  }
  if (patch.bidCaps !== undefined) {
    const merged = { ...getSettings().bidCaps, ...patch.bidCaps };
    writeSetting(
      "bid_caps",
      JSON.stringify({
        maxInputPrice: Math.max(0, merged.maxInputPrice),
        maxOutputPrice: Math.max(0, merged.maxOutputPrice),
      }),
    );
  }
  if (patch.baseUrl !== undefined) {
    writeSetting("base_url", patch.baseUrl.trim());
  }
  if (patch.apiKey !== undefined && patch.apiKey.trim()) {
    writeSetting("api_key", patch.apiKey.trim());
  }
  return getSettings();
}

/**
 * A profile picked in the composer uses that profile's defaults; the active
 * profile keeps its custom roles.
 */
export function resolveRunRoles(
  settings: Settings,
  requestedProfile: string | null | undefined,
): { profile: ProfileId; roles: RoleModelMap } {
  const profile: ProfileId = isProfileId(requestedProfile)
    ? requestedProfile
    : settings.profile;
  if (profile !== settings.profile) {
    const defaults = resolveProfile(profile).roles;
    const roles = {} as RoleModelMap;
    for (const role of ROLE_IDS) {
      roles[role] = {
        primary: defaults[role].primary,
        fallbacks: [...defaults[role].fallbacks],
      };
    }
    return { profile, roles };
  }
  return { profile, roles: settings.roles };
}

/**
 * The public view of the settings. `Settings` only carries the masked key, so
 * the raw key can never leak through this object; it exists to make that
 * guarantee explicit at every route boundary.
 */
export function publicSettings(settings: Settings): Settings {
  return { ...settings, apiKeyMasked: maskKey(getApiKey()) };
}
