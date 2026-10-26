import type { BidCaps, ProfileDef, ProfileId, RoleModelMap } from "./types";

export const DEFAULT_PROFILE: ProfileId = "combo";

export const DEFAULT_BID_CAPS: BidCaps = {
  maxInputPrice: 0.2,
  maxOutputPrice: 1.0,
};

export const PROFILES: ProfileDef[] = [
  {
    id: "hemat",
    label: "Hemat",
    blurb:
      "Cheapest models everywhere. Fast and inexpensive, with lighter judgment on the discovery brief.",
    roles: {
      intake: {
        primary: "zai/glm-5.3-flash",
        fallbacks: ["cb/glm-5.3-flash", "cb/deepseek-v4.1-flash"],
      },
      reasoning: {
        primary: "cb/deepseek-v4.1-flash",
        fallbacks: ["zai/glm-5.3-flash", "cx/gpt-6-luna"],
      },
      writer: {
        primary: "zai/glm-5.3-flash",
        fallbacks: ["cb/glm-5.3-flash", "cb/deepseek-v4.1-flash"],
      },
      architect: {
        primary: "cb/deepseek-v4.1-flash",
        fallbacks: ["zai/glm-5.3-flash", "cb/glm-5.3-flash"],
      },
      contracts: {
        primary: "cb/deepseek-v4.1-flash",
        fallbacks: ["zai/glm-5.3-flash", "cb/glm-5.3-flash"],
      },
      tasks: {
        primary: "zai/glm-5.3-flash",
        fallbacks: ["cb/glm-5.3-flash", "cb/deepseek-v4.1-flash"],
      },
    },
  },
  {
    id: "combo",
    label: "Combo",
    blurb:
      "Frontier reasoning for the discovery brief, cheap models for the bulk document prose. Default.",
    roles: {
      intake: {
        primary: "zai/glm-5.3-flash",
        fallbacks: ["cb/glm-5.3-flash", "cb/deepseek-v4.1-flash"],
      },
      reasoning: {
        primary: "cx/gpt-6.1-sol",
        fallbacks: ["cx/gpt-6-sol", "cx/gpt-5.6-sol"],
      },
      writer: {
        primary: "zai/glm-5.3",
        fallbacks: ["cb/glm-5.3", "cbcn/glm-5.3-flash"],
      },
      architect: {
        primary: "cb/deepseek-v4.1-flash",
        fallbacks: ["zai/glm-5.3", "cb/glm-5.3"],
      },
      contracts: {
        primary: "cb/deepseek-v4.1-flash",
        fallbacks: ["zai/glm-5.3-flash", "cb/glm-5.3-flash"],
      },
      tasks: {
        primary: "zai/glm-5.3",
        fallbacks: ["cb/kimi-k2.7", "cb/deepseek-v4.1-flash"],
      },
    },
  },
  {
    id: "maksimal",
    label: "Maksimal",
    blurb:
      "Frontier models for every stage, including Opus 5.5 for reasoning. Highest quality and cost.",
    roles: {
      intake: {
        primary: "zai/glm-5.3-flash",
        fallbacks: ["cbcn/glm-5.3-flash"],
      },
      reasoning: {
        primary: "kiro-opus-5.5",
        fallbacks: ["cx/gpt-6.1-sol", "cx/gpt-6-astra"],
      },
      writer: {
        primary: "cb/glm-5.3",
        fallbacks: ["cbcn/glm-5.3", "zai/glm-5.3"],
      },
      architect: {
        primary: "cx/gpt-6.1-sol",
        fallbacks: ["cx/gpt-5.6-terra", "cbcn/deepseek-v4.1-flash"],
      },
      contracts: {
        primary: "cx/gpt-5.6-terra",
        fallbacks: ["cbcn/deepseek-v4.1-flash", "cb/glm-5.3"],
      },
      tasks: {
        primary: "cb/glm-5.3",
        fallbacks: ["cb/kimi-k2.7", "cbcn/kimi-k3"],
      },
    },
  },
];

export const PROFILE_BY_ID: Record<ProfileId, ProfileDef> = {
  hemat: PROFILES[0],
  combo: PROFILES[1],
  maksimal: PROFILES[2],
};

export function isProfileId(value: unknown): value is ProfileId {
  return typeof value === "string" && value in PROFILE_BY_ID;
}

export function resolveProfile(id: string | null | undefined): ProfileDef {
  return isProfileId(id) ? PROFILE_BY_ID[id] : PROFILE_BY_ID[DEFAULT_PROFILE];
}

export function cloneRoles(roles: RoleModelMap): RoleModelMap {
  const out = {} as RoleModelMap;
  for (const key of Object.keys(roles) as Array<keyof RoleModelMap>) {
    out[key] = {
      primary: roles[key].primary,
      fallbacks: [...roles[key].fallbacks],
    };
  }
  return out;
}

export function roleChain(roles: RoleModelMap, role: keyof RoleModelMap): string[] {
  const entry = roles[role];
  const chain: string[] = [];
  for (const id of [entry.primary, ...entry.fallbacks]) {
    const trimmed = id.trim();
    if (trimmed && !chain.includes(trimmed)) chain.push(trimmed);
  }
  return chain;
}
