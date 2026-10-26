export interface Preset {
  id: string;
  label: string;
  guidance: string;
}

export const PRESETS: Preset[] = [
  {
    id: "web-app",
    label: "Web App",
    guidance:
      "This product ships as a browser-based web application. Assume a responsive web frontend with server-side or static hosting. Do not propose native mobile apps or desktop installers.",
  },
  {
    id: "mobile",
    label: "Mobile App",
    guidance:
      "This product ships as a native mobile application for iOS and Android. Assume app store distribution, device capabilities such as push notifications, camera, and offline storage, plus a supporting backend API. Do not propose a web-only frontend.",
  },
  {
    id: "api",
    label: "API / Backend Service",
    guidance:
      "This product ships as a headless API or backend service consumed by other software. There are no end-user screens in scope. Focus on API contracts, client SDKs, authentication, rate limiting, and operational concerns. Do not propose user-facing UI.",
  },
  {
    id: "internal",
    label: "Internal Tool",
    guidance:
      "This product ships as an internal tool for a single organization. Assume a small, known user base, no public signup, and existing identity or SSO where plausible. Favor operational simplicity over scale.",
  },
];

export const DEFAULT_PRESET = "web-app";

const PRESET_BY_ID = new Map(PRESETS.map((p) => [p.id, p]));

export function presetBlock(preset?: string): string {
  const p = preset ? PRESET_BY_ID.get(preset) : undefined;
  return p ? `Platform constraint (${p.label}): ${p.guidance}` : "";
}
