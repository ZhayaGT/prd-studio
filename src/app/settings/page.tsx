"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { formatUsd } from "@/lib/format";
import { ROLE_HINTS, ROLE_IDS, ROLE_LABELS, PROFILE_LABELS } from "@/lib/labels";
import { resolveProfile } from "@/lib/profiles";
import type { RoleId, RoleModelMap } from "@/lib/types";
import type {
  ModelsPayload,
  ModelView,
  ProfileView,
  SettingsPayload,
  SettingsView,
} from "@/lib/ui-types";

const FALLBACK_SLOTS = 3;

function priceOf(model: ModelView | undefined): number | null {
  if (!model?.pricing) return null;
  return model.pricing.inPerMtok;
}

function formatPrice(model: ModelView | undefined): string {
  if (!model?.pricing) return "price unknown";
  const { inPerMtok, outPerMtok, origin } = model.pricing;
  return `$${inPerMtok} in / $${outPerMtok} out per Mtok${origin === "fallback" ? " (fallback)" : ""}`;
}

function sortedModels(models: ModelView[], current: string[]): ModelView[] {
  const seen = new Set(models.map((m) => m.id));
  const extra = current
    .filter((id) => id && !seen.has(id))
    .map<ModelView>((id) => ({
      id,
      label: `${id} (not in catalog)`,
      contextLimit: null,
      maxOutput: null,
      supportsCache: false,
      reasoningLevels: [],
      pricing: null,
    }));
  const all = [...models, ...extra];
  return all.sort((a, b) => {
    const pa = priceOf(a);
    const pb = priceOf(b);
    if (pa === null && pb === null) return a.id.localeCompare(b.id);
    if (pa === null) return 1;
    if (pb === null) return -1;
    if (pa !== pb) return pa - pb;
    return a.id.localeCompare(b.id);
  });
}

function cloneRoles(roles: RoleModelMap): RoleModelMap {
  const out = {} as RoleModelMap;
  for (const role of ROLE_IDS) {
    out[role] = {
      primary: roles[role].primary,
      fallbacks: [...roles[role].fallbacks],
    };
  }
  return out;
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<SettingsView | null>(null);
  const [profiles, setProfiles] = useState<ProfileView[]>([]);
  const [spend, setSpend] = useState({ all: 0, last30: 0 });
  const [models, setModels] = useState<ModelView[]>([]);
  const [modelsMeta, setModelsMeta] = useState<{
    updatedAt: string | null;
    count: number;
    error?: string;
  }>({ updatedAt: null, count: 0 });

  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [profile, setProfile] = useState("combo");
  const [roles, setRoles] = useState<RoleModelMap>(resolveProfile("combo").roles);
  const [bidCaps, setBidCaps] = useState({ maxInputPrice: 0.2, maxOutputPrice: 1 });

  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: "ok" | "error" | "warn"; text: string } | null>(
    null,
  );

  const applySettings = useCallback((view: SettingsView) => {
    setSettings(view);
    setBaseUrl(view.baseUrl);
    setProfile(view.profile);
    setRoles(cloneRoles(view.roles as RoleModelMap));
    setBidCaps(view.bidCaps);
  }, []);

  const loadSettings = useCallback(async () => {
    const res = await fetch("/api/settings");
    const json = (await res.json()) as SettingsPayload & { error?: string };
    if (!json.settings) throw new Error(json.error ?? "Settings unavailable");
    applySettings(json.settings);
    setProfiles(json.profiles ?? []);
    setSpend(json.spend ?? { all: 0, last30: 0 });
  }, [applySettings]);

  const loadModels = useCallback(async () => {
    const res = await fetch("/api/models");
    const json = (await res.json()) as ModelsPayload;
    setModels(json.models ?? []);
    setModelsMeta({
      updatedAt: json.updatedAt ?? null,
      count: json.count ?? 0,
      error: json.error,
    });
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        await loadSettings();
        await loadModels();
      } catch (error) {
        setNotice({
          kind: "error",
          text: error instanceof Error ? error.message : "Could not load settings.",
        });
      }
    })();
  }, [loadSettings, loadModels]);

  const ordered = useMemo(() => {
    const current = ROLE_IDS.flatMap((role) => [
      roles[role].primary,
      ...roles[role].fallbacks,
    ]);
    return sortedModels(models, current);
  }, [models, roles]);

  const byId = useMemo(() => {
    const map: Record<string, ModelView> = {};
    for (const model of models) map[model.id] = model;
    return map;
  }, [models]);

  const profileDefaults = useMemo(() => resolveProfile(profile).roles, [profile]);

  async function save(payload: Record<string, unknown>, label: string) {
    setBusy(label);
    setNotice(null);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = (await res.json()) as SettingsPayload & {
        error?: string;
        test?: { ok: boolean; count?: number; error?: string };
        catalog?: { count: number };
        catalogError?: string;
      };
      if (!res.ok || !json.settings) {
        throw new Error(json.error ?? `Save failed (HTTP ${res.status})`);
      }
      applySettings(json.settings);
      setProfiles(json.profiles ?? []);
      setSpend(json.spend ?? { all: 0, last30: 0 });
      if (json.test) {
        setNotice(
          json.test.ok
            ? { kind: "ok", text: `Key works. ${json.test.count ?? 0} models available.` }
            : { kind: "error", text: json.test.error ?? "Key test failed." }
        );
      } else if (json.catalog) {
        setNotice({ kind: "ok", text: `Catalog refreshed: ${json.catalog.count} models.` });
      } else if (json.catalogError) {
        setNotice({ kind: "warn", text: `Saved, but catalog refresh failed: ${json.catalogError}` });
      } else {
        setNotice({ kind: "ok", text: "Saved." });
      }
      if (payload.test || payload.refreshCatalog) await loadModels();
    } catch (error) {
      setNotice({
        kind: "error",
        text: error instanceof Error ? error.message : "Save failed.",
      });
    } finally {
      setBusy(null);
    }
  }

  function setRole(role: RoleId, patch: Partial<{ primary: string; fallbacks: string[] }>) {
    setRoles((prev) => ({
      ...prev,
      [role]: {
        primary: patch.primary ?? prev[role].primary,
        fallbacks: patch.fallbacks ?? prev[role].fallbacks,
      },
    }));
  }

  function setFallback(role: RoleId, index: number, value: string) {
    setRoles((prev) => {
      const fallbacks = [...prev[role].fallbacks];
      while (fallbacks.length < FALLBACK_SLOTS) fallbacks.push("");
      fallbacks[index] = value;
      return {
        ...prev,
        [role]: {
          primary: prev[role].primary,
          fallbacks: fallbacks.filter((id, i) => id || i < index + 1),
        },
      };
    });
  }

  function fallbackValue(role: RoleId, index: number): string {
    return roles[role].fallbacks[index] ?? "";
  }

  function changeProfile(next: string) {
    setProfile(next);
    setRoles(cloneRoles(resolveProfile(next).roles));
  }

  const capWarning = (role: RoleId) => {
    const price = priceOf(byId[roles[role].primary]);
    if (price === null) return null;
    if (bidCaps.maxInputPrice > 0 && price > bidCaps.maxInputPrice) {
      return `above bid cap ($${bidCaps.maxInputPrice} in)`;
    }
    return null;
  };

  const profileBlurb = profiles.find((p) => p.id === profile)?.blurb ?? "";
  const activeProfile = settings?.profile ?? "combo";
  const savedAt = modelsMeta.updatedAt
    ? new Date(modelsMeta.updatedAt).toLocaleString()
    : "never";

  return (
    <div className="app">
      <header className="topbar">
        <div className="wordmark">
          <Link href="/" className="wordmark-name" style={{ textDecoration: "none" }}>
            PRD Studio
          </Link>
          <span className="wordmark-rule" aria-hidden="true" />
          <span className="mono-label">settings</span>
        </div>
        <div className="topbar-right">
          <Link href="/" className="btn btn-ghost btn-sm">
            Back to workspace
          </Link>
        </div>
      </header>

      <div className="page">
        <div className="page-inner">
          <div className="page-head">
            <span className="mono-label">Routing</span>
            <h1 className="page-title">Models by role</h1>
            <p className="page-lede">
              Each stage calls one role. A role has a primary model plus fallbacks, tried in
              order when a provider is unavailable. Spend is recorded per call.
            </p>
          </div>

          {notice && (
            <div
              className={`notice${
                notice.kind === "error"
                  ? " notice-error"
                  : notice.kind === "warn"
                    ? " notice-warn"
                    : " notice-ok"
              }`}
            >
              <span className="notice-label">
                {notice.kind === "error" ? "Error" : notice.kind === "warn" ? "Note" : "Saved"}
              </span>
              <span>{notice.text}</span>
            </div>
          )}

          <section className="settings-section">
            <h2 className="settings-title">API key &amp; endpoint</h2>
            <p className="settings-hint">
              Stored locally in the SQLite database. Leave the key blank to keep the current one.
              Environment variables are used when nothing is stored.
            </p>
            <div className="control-grid">
              <label className="control">
                <span className="mono-label">InferHub API key</span>
                <input
                  className="select"
                  type="password"
                  autoComplete="off"
                  placeholder={settings?.apiKeyMasked || "sk-…"}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                />
                <span className="control-hint">
                  {settings?.hasApiKey
                    ? `Current: ${settings.apiKeyMasked}`
                    : "No key configured yet."}
                </span>
              </label>
              <label className="control">
                <span className="mono-label">Base URL</span>
                <input
                  className="select"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder="https://api.inferhub.dev/v1"
                />
                <span className="control-hint">Empty falls back to the environment default.</span>
              </label>
            </div>
            <div className="settings-actions">
              <button
                className="btn btn-primary btn-sm"
                disabled={busy !== null}
                onClick={() =>
                  save(
                    {
                      ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
                      baseUrl,
                      test: true,
                    },
                    "test",
                  )
                }
              >
                {busy === "test" ? "Testing…" : "Save & test"}
              </button>
              <button
                className="btn btn-secondary btn-sm"
                disabled={busy !== null}
                onClick={() => save({ refreshCatalog: true }, "catalog")}
              >
                {busy === "catalog" ? "Refreshing…" : "Refresh catalog"}
              </button>
              <span className="mono-value">
                {modelsMeta.count} models · updated {savedAt}
              </span>
            </div>
            {modelsMeta.error && (
              <p className="settings-hint settings-hint-warn">
                Catalog unavailable: {modelsMeta.error}
              </p>
            )}
          </section>

          <section className="settings-section">
            <h2 className="settings-title">Profile</h2>
            <p className="settings-hint">
              A profile is a preset role map. Saving a profile replaces the saved roles with that
              profile&apos;s defaults.
            </p>
            <div className="control-grid">
              <label className="control">
                <span className="mono-label">Active profile</span>
                <select
                  className="select"
                  value={profile}
                  onChange={(e) => changeProfile(e.target.value)}
                >
                  {(profiles.length ? profiles : Object.values(PROFILE_LABELS).map((label, i) => ({
                    id: ["hemat", "combo", "maksimal"][i],
                    label,
                    blurb: "",
                  }))).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                      {p.id === activeProfile ? " (active)" : ""}
                    </option>
                  ))}
                </select>
                <span className="control-hint">{profileBlurb}</span>
              </label>
            </div>
            <div className="settings-actions">
              <button
                className="btn btn-primary btn-sm"
                disabled={busy !== null}
                onClick={() => save({ profile }, "profile")}
              >
                {busy === "profile" ? "Saving…" : "Save profile"}
              </button>
            </div>
          </section>

          <section className="settings-section">
            <h2 className="settings-title">Roles</h2>
            <p className="settings-hint">
              Primary first, then up to three fallbacks. Prices are catalog minimum asks, not a
              guarantee.
            </p>

            {ROLE_IDS.map((role) => {
              const primary = byId[roles[role].primary];
              const warn = capWarning(role);
              return (
                <div className="role-row" key={role}>
                  <div className="role-head">
                    <span className="role-name">{ROLE_LABELS[role]}</span>
                    <span className="role-hint">{ROLE_HINTS[role]}</span>
                  </div>
                  <div className="role-price">
                    {formatPrice(primary)}
                    {primary?.contextLimit
                      ? ` · ${Math.round(primary.contextLimit / 1000)}k context`
                      : ""}
                    {primary?.maxOutput ? ` · ${Math.round(primary.maxOutput / 1000)}k out` : ""}
                    {primary?.supportsCache ? " · cache" : ""}
                    {primary?.reasoningLevels.length
                      ? ` · reasoning: ${primary.reasoningLevels.join("/")}`
                      : ""}
                    {warn && <span className="role-cap-warn"> · {warn}</span>}
                  </div>
                  <div className="role-grid">
                    <label className="control">
                      <span className="mono-label">Primary</span>
                      <select
                        className="select"
                        value={roles[role].primary}
                        onChange={(e) => setRole(role, { primary: e.target.value })}
                      >
                        {ordered.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.id}
                          </option>
                        ))}
                      </select>
                    </label>
                    {Array.from({ length: FALLBACK_SLOTS }).map((_, index) => (
                      <label className="control" key={index}>
                        <span className="mono-label">Fallback {index + 1}</span>
                        <select
                          className="select"
                          value={fallbackValue(role, index)}
                          onChange={(e) => setFallback(role, index, e.target.value)}
                        >
                          <option value="">(none)</option>
                          {ordered.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.id}
                            </option>
                          ))}
                        </select>
                      </label>
                    ))}
                  </div>
                </div>
              );
            })}

            <div className="settings-actions">
              <button
                className="btn btn-primary btn-sm"
                disabled={busy !== null}
                onClick={() => save({ roles }, "roles")}
              >
                {busy === "roles" ? "Saving…" : "Save roles"}
              </button>
              <button
                className="btn btn-ghost btn-sm"
                disabled={busy !== null}
                onClick={() => setRoles(cloneRoles(profileDefaults))}
              >
                Reset to{" "}
                {PROFILE_LABELS[profile as keyof typeof PROFILE_LABELS] ?? profile} defaults
              </button>
            </div>
          </section>

          <section className="settings-section">
            <h2 className="settings-title">Bid caps &amp; spend</h2>
            <p className="settings-hint">
              Requests carry these caps; a provider above the cap is skipped rather than paid.
              0 means no cap.
            </p>
            <div className="control-grid">
              <label className="control">
                <span className="mono-label">Max input price</span>
                <input
                  className="select"
                  type="number"
                  min={0}
                  step={0.001}
                  value={bidCaps.maxInputPrice}
                  onChange={(e) =>
                    setBidCaps((prev) => ({
                      ...prev,
                      maxInputPrice: Number(e.target.value) || 0,
                    }))
                  }
                />
                <span className="control-hint">USD per million input tokens.</span>
              </label>
              <label className="control">
                <span className="mono-label">Max output price</span>
                <input
                  className="select"
                  type="number"
                  min={0}
                  step={0.001}
                  value={bidCaps.maxOutputPrice}
                  onChange={(e) =>
                    setBidCaps((prev) => ({
                      ...prev,
                      maxOutputPrice: Number(e.target.value) || 0,
                    }))
                  }
                />
                <span className="control-hint">USD per million output tokens.</span>
              </label>
            </div>
            <div className="settings-actions">
              <button
                className="btn btn-primary btn-sm"
                disabled={busy !== null}
                onClick={() => save({ bidCaps }, "caps")}
              >
                {busy === "caps" ? "Saving…" : "Save bid caps"}
              </button>
            </div>
            <div className="spend-line">
              Spend all time: <strong>{formatUsd(spend.all)}</strong> · last 30 days:{" "}
              <strong>{formatUsd(spend.last30)}</strong>
            </div>
            <p className="settings-hint">
              Actual cost comes from each call&apos;s <code>usage.cost</code>. Catalog prices are
              the cheapest ask, not a guarantee.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
