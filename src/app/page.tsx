"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Markdown } from "@/components/Markdown";
import { formatTokens, formatUsd } from "@/lib/format";
import { PROFILE_LABELS, ROLE_IDS, ROLE_SHORT_LABELS } from "@/lib/labels";
import { PRESETS } from "@/lib/presets";
import { PROFILE_BY_ID, resolveProfile } from "@/lib/profiles";
import type { SettingsPayload, SettingsView } from "@/lib/ui-types";
import type {
  BriefContext,
  ClarifyQuestion,
  ClarifyResult,
  PipelineEvent,
  ProfileId,
  ProjectSummary,
  RoleModelMap,
  StageId,
} from "@/lib/types";

type Step = "idea" | "confirm" | "generate";

const STEPS: Array<{ id: Step; label: string }> = [
  { id: "idea", label: "Idea" },
  { id: "confirm", label: "Confirm" },
  { id: "generate", label: "Generate" },
];

const STAGE_UI: Array<{ id: StageId; label: string; blurb: string }> = [
  {
    id: "discovery",
    label: "Discovery",
    blurb: "Problem, users, scope, and assumptions.",
  },
  {
    id: "prd",
    label: "Product requirements",
    blurb: "Vision, journeys, features, and success metrics.",
  },
  {
    id: "architecture",
    label: "Architecture",
    blurb: "Stack, frontend, backend, data, and deployment.",
  },
  {
    id: "dataApi",
    label: "Data & API",
    blurb: "Entities, relationships, and endpoint contracts.",
  },
  {
    id: "tasks",
    label: "Tasks",
    blurb: "Phased task list ready for an AI coding agent.",
  },
];

const STAGE_ORDER = STAGE_UI.map((s) => s.id);

const LANGUAGES = ["English", "Bahasa Indonesia"];

const EXAMPLES = [
  "Personal finance tracker with budgets and charts",
  "Internal tool for reviewing vendor contracts",
  "API that normalizes payment webhooks",
];

type StageStatus = "idle" | "running" | "done";
type AnswerMap = Record<string, string | string[]>;
type NoteMap = Record<string, string>;

const EMPTY_STATUS: Record<StageId, StageStatus> = {
  discovery: "idle",
  prd: "idle",
  architecture: "idle",
  dataApi: "idle",
  tasks: "idle",
};

function formatDate(value: string) {
  return new Date(value).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default function Home() {
  const [step, setStep] = useState<Step>("idea");

  const [idea, setIdea] = useState("");
  const [settings, setSettings] = useState<SettingsView | null>(null);
  const [settingsProfiles, setSettingsProfiles] = useState<SettingsPayload["profiles"]>([]);
  const [profile, setProfile] = useState<ProfileId>("combo");
  const [settingsNote, setSettingsNote] = useState<string | null>(null);
  const [language, setLanguage] = useState("English");
  const [preset, setPreset] = useState(PRESETS[0].id);

  const [analyzing, setAnalyzing] = useState(false);
  const [clarify, setClarify] = useState<ClarifyResult | null>(null);
  const [analyzedIdea, setAnalyzedIdea] = useState("");
  const [answers, setAnswers] = useState<AnswerMap>({});
  const [notes, setNotes] = useState<NoteMap>({});

  const [busy, setBusy] = useState<"full" | StageId | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<ProjectSummary | null>(null);
  const [active, setActive] = useState<StageId>("discovery");
  const [stages, setStages] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<Record<StageId, StageStatus>>(EMPTY_STATUS);
  const [truncated, setTruncated] = useState<Record<string, boolean>>({});
  const [stale, setStale] = useState<Record<string, boolean>>({});
  const [stageModels, setStageModels] = useState<Record<string, string>>({});
  const [stageFallback, setStageFallback] = useState<Record<string, boolean>>({});
  const [liveCost, setLiveCost] = useState(0);
  const [runTokens, setRunTokens] = useState({ input: 0, output: 0 });

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [savingEdits, setSavingEdits] = useState(false);

  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const bufferRef = useRef<Record<string, string>>({});
  const flushRef = useRef<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const running = busy !== null;
  const trimmedIdea = idea.trim();
  const canReview = trimmedIdea.length >= 10 && !analyzing;

  const answeredCount = useMemo(() => {
    if (!clarify) return 0;
    return clarify.questions.filter((q) => {
      const value = answers[q.id];
      const filled = Array.isArray(value) ? value.length > 0 : Boolean(value);
      return filled || Boolean(notes[q.id]?.trim());
    }).length;
  }, [clarify, answers, notes]);

  const loadProjects = useCallback(async () => {
    try {
      const res = await fetch("/api/projects");
      const json = (await res.json()) as { projects: ProjectSummary[] };
      setProjects(json.projects ?? []);
    } catch {
      setProjects([]);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const res = await fetch("/api/projects");
        const json = (await res.json()) as { projects: ProjectSummary[] };
        if (!cancelled) setProjects(json.projects ?? []);
      } catch {
        if (!cancelled) setProjects([]);
      }
    })();

    void (async () => {
      try {
        const res = await fetch("/api/settings");
        const json = (await res.json()) as SettingsPayload & { error?: string };
        if (cancelled) return;
        if (!json.settings) {
          setSettingsNote("Settings unavailable.");
          return;
        }
        setSettings(json.settings);
        setSettingsProfiles(json.profiles ?? []);
        setProfile(json.settings.profile as ProfileId);
        if (!json.settings.hasApiKey) {
          setSettingsNote("No API key yet. Add one in Settings.");
        }
      } catch {
        if (!cancelled) setSettingsNote("Settings unavailable.");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const effectiveRoles: RoleModelMap = useMemo(() => {
    if (settings && profile === settings.profile) return settings.roles as RoleModelMap;
    return resolveProfile(profile).roles;
  }, [settings, profile]);

  const activeProfileLabel =
    settingsProfiles.find((p) => p.id === profile)?.label ??
    PROFILE_LABELS[profile] ??
    PROFILE_LABELS.combo;

  const activeProfileBlurb =
    settingsProfiles.find((p) => p.id === profile)?.blurb ??
    PROFILE_BY_ID[profile]?.blurb ??
    "";

  const appendText = useCallback((id: string, text: string) => {
    bufferRef.current[id] = (bufferRef.current[id] ?? "") + text;
    if (flushRef.current === null) {
      flushRef.current = window.setTimeout(() => {
        flushRef.current = null;
        setStages({ ...bufferRef.current });
      }, 100);
    }
  }, []);

  const handleEvent = useCallback(
    (event: PipelineEvent) => {
      if (event.type === "stage_start") {
        setActive(event.id);
        setStatus((prev) => ({ ...prev, [event.id]: "running" }));
        setStageModels((prev) => ({ ...prev, [event.id]: event.model }));
      } else if (event.type === "delta") {
        appendText(event.id, event.text);
      } else if (event.type === "stage_end") {
        setStatus((prev) => ({ ...prev, [event.id]: "done" }));
        setStageModels((prev) => ({ ...prev, [event.id]: event.model }));
        setStageFallback((prev) => ({ ...prev, [event.id]: event.fallback }));
        setRunTokens((prev) => ({
          input: prev.input + event.inputTokens,
          output: prev.output + event.outputTokens,
        }));
        if (event.truncated) {
          setTruncated((prev) => ({ ...prev, [event.id]: true }));
        }
      } else if (event.type === "cost") {
        setLiveCost(event.totalUsd);
      } else if (event.type === "done") {
        setSaved(event.project);
        setStatus({ ...EMPTY_STATUS, discovery: "done", prd: "done", architecture: "done", dataApi: "done", tasks: "done" });
        loadProjects();
        void (async () => {
          try {
            const res = await fetch(`/api/projects/${event.project.id}`);
            const json = (await res.json()) as {
              project?: { stages: Record<string, string> };
            };
            if (!json.project) return;
            bufferRef.current = { ...json.project.stages };
            setStages({ ...json.project.stages });
          } catch {
            /* keep streamed text */
          }
        })();
      } else if (event.type === "error") {
        setError(event.message);
      }
    },
    [appendText, loadProjects],
  );

  async function consume(res: Response) {
    if (!res.ok || !res.body) {
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(json.error ?? `Request failed (HTTP ${res.status})`);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        handleEvent(JSON.parse(line) as PipelineEvent);
      }
    }
  }

  function markDownstreamStale(id: StageId) {
    const index = STAGE_ORDER.indexOf(id);
    const next: Record<string, boolean> = {};
    for (const s of STAGE_ORDER.slice(index + 1)) next[s] = true;
    setStale((prev) => ({ ...prev, ...next }));
  }

  async function reviewIdea() {
    if (!canReview) return;

    if (clarify && analyzedIdea === trimmedIdea) {
      setStep("confirm");
      return;
    }

    setAnalyzing(true);
    setError(null);
    try {
      const res = await fetch("/api/clarify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idea: trimmedIdea, language, profile }),
      });
      const json = (await res.json()) as ClarifyResult & { error?: string };
      if (!res.ok) {
        throw new Error(json.error ?? `Request failed (HTTP ${res.status})`);
      }
      setClarify(json);
      setAnalyzedIdea(trimmedIdea);
      setAnswers({});
      setNotes({});
      setStep("confirm");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not review the idea.",
      );
    } finally {
      setAnalyzing(false);
    }
  }

  function buildBrief(): BriefContext | null {
    if (!clarify) return null;
    const list = clarify.questions.map((q) => {
      const value = answers[q.id];
      const selected = Array.isArray(value) ? value.join(", ") : (value ?? "");
      const note = (notes[q.id] ?? "").trim();
      const answer = [selected.trim(), note].filter(Boolean).join(" — ");
      return {
        id: q.id,
        question: q.question,
        answer,
        skipped: answer.length === 0,
      };
    });
    return {
      summary: clarify.summary,
      answers: list,
      assumptions: clarify.assumptions,
    };
  }

  async function generate() {
    if (running || trimmedIdea.length < 10) return;

    setStep("generate");
    setBusy("full");
    setError(null);
    setSaved(null);
    setEditing(false);
    bufferRef.current = {};
    setStages({});
    setTruncated({});
    setStale({});
    setStageModels({});
    setStageFallback({});
    setLiveCost(0);
    setRunTokens({ input: 0, output: 0 });
    setActive("discovery");
    setStatus(EMPTY_STATUS);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          idea: trimmedIdea,
          language,
          preset,
          profile,
          brief: buildBrief(),
        }),
        signal: controller.signal,
      });
      await consume(res);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        setError("Generation stopped. Nothing was saved.");
      } else {
        setError(err instanceof Error ? err.message : "Generation failed.");
      }
    } finally {
      setBusy(null);
      abortRef.current = null;
    }
  }

  async function saveEdits(): Promise<boolean> {
    if (!saved) return false;
    setSavingEdits(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${saved.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stages: { [active]: draft } }),
      });
      const json = (await res.json()) as {
        project?: ProjectSummary;
        error?: string;
      };
      if (!res.ok || !json.project) {
        throw new Error(json.error ?? `Save failed (HTTP ${res.status})`);
      }
      bufferRef.current[active] = draft;
      setStages({ ...bufferRef.current });
      setSaved(json.project);
      setEditing(false);
      markDownstreamStale(active);
      loadProjects();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save changes.");
      return false;
    } finally {
      setSavingEdits(false);
    }
  }

  async function regenerate(stageId: StageId) {
    if (!saved || running) return;
    if (editing && !(await saveEdits())) return;
    if (!stages[stageId]) return;

    setBusy(stageId);
    setError(null);
    setActive(stageId);
    setTruncated((prev) => ({ ...prev, [stageId]: false }));
    setLiveCost(0);
    setRunTokens({ input: 0, output: 0 });
    bufferRef.current = { ...stages, [stageId]: "" };
    setStages({ ...bufferRef.current });
    setStatus((prev) => ({ ...prev, [stageId]: "running" }));

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch(`/api/projects/${saved.id}/regenerate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage: stageId, preset, profile }),
        signal: controller.signal,
      });
      await consume(res);
      setStatus((prev) => ({ ...prev, [stageId]: "done" }));
      setStale((prev) => ({ ...prev, [stageId]: false }));
      markDownstreamStale(stageId);
    } catch (err) {
      setStatus((prev) => ({ ...prev, [stageId]: "done" }));
      if (err instanceof DOMException && err.name === "AbortError") {
        setError("Regeneration stopped.");
      } else {
        setError(
          err instanceof Error ? err.message : "Regeneration failed.",
        );
      }
    } finally {
      setBusy(null);
      abortRef.current = null;
    }
  }

  async function remove(id: string, title: string) {
    if (!window.confirm(`Delete "${title}"? This cannot be undone.`)) return;
    await fetch(`/api/projects/${id}`, { method: "DELETE" });
    if (saved?.id === id) {
      setSaved(null);
      setStages({});
      bufferRef.current = {};
      setStale({});
      setStep("idea");
    }
    loadProjects();
  }

  function stop() {
    abortRef.current?.abort();
  }

  async function download() {
    if (!saved) return;
    const res = await fetch(`/api/projects/${saved.id}`);
    const json = (await res.json()) as {
      project?: { content: string; title: string };
    };
    if (!json.project) return;
    const blob = new Blob([json.project.content], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${saved.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function startEdit() {
    setDraft(stages[active] ?? "");
    setEditing(true);
  }

  function setSingle(id: string, value: string) {
    setAnswers((prev) => ({ ...prev, [id]: prev[id] === value ? "" : value }));
  }

  function toggleMulti(id: string, value: string) {
    setAnswers((prev) => {
      const current = Array.isArray(prev[id]) ? (prev[id] as string[]) : [];
      const next = current.includes(value)
        ? current.filter((v) => v !== value)
        : [...current, value];
      return { ...prev, [id]: next };
    });
  }

  const hasOutput = Object.keys(stages).length > 0;
  const generating = busy === "full";
  const canRegenerate =
    saved !== null && !running && Boolean(stages[active]) && !editing;

  return (
    <div className="app">
      <header className="topbar">
        <div className="wordmark">
          <span className="wordmark-name">PRD Studio</span>
          <span className="wordmark-rule" aria-hidden="true" />
          <span className="mono-label">idea to build plan</span>
        </div>
        <div className="topbar-right">
          <span
            className="model-readout"
            title={`${activeProfileLabel} · ${formatUsd(liveCost)} this run`}
          >
            <span className={`live-dot${running ? " live-dot-busy" : ""}`} aria-hidden="true" />
            <span>
              {activeProfileLabel} · {formatUsd(liveCost)}
            </span>
          </span>
          <button className="btn btn-secondary btn-sm" onClick={() => setDrawerOpen(true)}>
            History
            <span className="mono-value" style={{ marginLeft: 7 }}>
              {projects.length}
            </span>
          </button>
        </div>
      </header>

      <nav className="stepper" aria-label="Progress">
        {STEPS.map((s, index) => {
          const currentIndex = STEPS.findIndex((x) => x.id === step);
          const isActive = step === s.id;
          const isDone = index < currentIndex;
          const locked = running;
          return (
            <button
              key={s.id}
              className={`step${isActive ? " step-active" : ""}${isDone ? " step-done" : ""}`}
              onClick={() => setStep(s.id)}
              disabled={locked || (s.id === "generate" && !hasOutput)}
              aria-current={isActive ? "step" : undefined}
            >
              <span className="step-index">
                {String(index + 1).padStart(2, "0")}
              </span>
              {s.label}
            </button>
          );
        })}
      </nav>

      <div className="stage-area">
        {step === "idea" && (
          <div className="page">
            <div className="page-inner">
              <div className="page-head">
                <span className="mono-label">Step 01</span>
                <h1 className="page-title">What are you building?</h1>
                <p className="page-lede">
                  Describe the product in your own words. Rough is fine — the
                  next step checks whether anything essential is missing before
                  a full plan is written.
                </p>
              </div>

              <div className="input-frame">
                <textarea
                  value={idea}
                  onChange={(e) => setIdea(e.target.value)}
                  className="idea-field"
                  placeholder="A personal finance site where people log income and expenses, set monthly budgets per category, and see where their money went."
                  aria-label="Describe your product idea"
                />
                <div className="field-foot">
                  <span className="counter">{trimmedIdea.length} characters</span>
                  {trimmedIdea.length > 0 && trimmedIdea.length < 10 && (
                    <span className="counter counter-warn">
                      At least 10 characters needed
                    </span>
                  )}
                </div>
              </div>

              <div className="examples">
                {EXAMPLES.map((example) => (
                  <button
                    key={example}
                    className="example-chip"
                    onClick={() => setIdea(example)}
                  >
                    {example}
                  </button>
                ))}
              </div>

              <div className="actions">
                <button
                  className="btn btn-primary"
                  onClick={reviewIdea}
                  disabled={!canReview}
                >
                  {analyzing ? "Reviewing…" : "Review idea"}
                </button>
                <span className="actions-note">
                  Takes a few seconds. No plan is generated yet.
                </span>
              </div>

              {error && (
                <div className="notice notice-error">
                  <span className="notice-label">Error</span>
                  <span>{error}</span>
                </div>
              )}

              <details className="advanced">
                <summary>Advanced settings</summary>
                <div className="control-grid">
                  <label className="control">
                    <span className="mono-label">Profile</span>
                    <select
                      className="select"
                      value={profile}
                      onChange={(e) => setProfile(e.target.value as ProfileId)}
                    >
                      {(settingsProfiles.length
                        ? settingsProfiles
                        : Object.values(PROFILE_BY_ID)
                      ).map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.label}
                        </option>
                      ))}
                    </select>
                    <span className="control-hint">{activeProfileBlurb}</span>
                  </label>
                  <label className="control">
                    <span className="mono-label">Platform</span>
                    <select
                      className="select"
                      value={preset}
                      onChange={(e) => setPreset(e.target.value)}
                    >
                      {PRESETS.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.label}
                        </option>
                      ))}
                    </select>
                    <span className="control-hint">
                      Constrains the architecture section.
                    </span>
                  </label>
                  <label className="control">
                    <span className="mono-label">Output language</span>
                    <select
                      className="select"
                      value={language}
                      onChange={(e) => setLanguage(e.target.value)}
                    >
                      {LANGUAGES.map((l) => (
                        <option key={l} value={l}>
                          {l}
                        </option>
                      ))}
                    </select>
                    <span className="control-hint">
                      Language of the generated documents.
                    </span>
                  </label>
                </div>

                <div className="profile-role-summary">
                  {ROLE_IDS.map((role) => (
                    <div key={role} className="profile-role-line">
                      <span className="mono-label">{ROLE_SHORT_LABELS[role]}</span>
                      <code>{effectiveRoles[role].primary}</code>
                      {effectiveRoles[role].fallbacks.length > 0 && (
                        <span className="mono-value">
                          +{effectiveRoles[role].fallbacks.length} fallback
                          {effectiveRoles[role].fallbacks.length > 1 ? "s" : ""}
                        </span>
                      )}
                    </div>
                  ))}
                </div>

                <p className="settings-hint">
                  {settingsNote ??
                    (profile === settings?.profile
                      ? "Using the roles saved in Settings."
                      : `Previewing ${activeProfileLabel} defaults. Save it in Settings to make it active.`)}{" "}
                  <Link href="/settings">Open Settings</Link>
                </p>
              </details>
            </div>
          </div>
        )}

        {step === "confirm" && (
          <div className="page">
            <div className="page-inner">
              <div className="page-head">
                <span className="mono-label">Step 02</span>
                <h1 className="page-title">
                  {clarify?.questions.length
                    ? "A few decisions first"
                    : "Confirm the brief"}
                </h1>
                <p className="page-lede">
                  {clarify?.questions.length
                    ? "Only what would change the plan. Anything you leave blank becomes a clearly tagged assumption."
                    : "Nothing essential is missing. Review what will be planned before the long run starts."}
                </p>
              </div>

              {clarify?.summary && (
                <div className="summary-block">
                  <span className="mono-label">Understood as</span>
                  <p style={{ marginTop: 8 }}>{clarify.summary}</p>
                </div>
              )}

              {clarify && clarify.questions.length > 0 && (
                <>
                  <div className="question-list">
                    {clarify.questions.map((q, index) => (
                      <QuestionCard
                        key={q.id}
                        index={index}
                        question={q}
                        value={answers[q.id]}
                        note={notes[q.id] ?? ""}
                        onSingle={(v) => setSingle(q.id, v)}
                        onToggle={(v) => toggleMulti(q.id, v)}
                        onNote={(v) =>
                          setNotes((prev) => ({ ...prev, [q.id]: v }))
                        }
                      />
                    ))}
                  </div>
                  <div className="progress-line">
                    <span className="progress-count">
                      {answeredCount} of {clarify.questions.length} answered
                    </span>
                    <span className="mono-value">
                      Unanswered → assumptions
                    </span>
                  </div>
                </>
              )}

              {clarify && clarify.assumptions.length > 0 && (
                <div className="brief-grid">
                  <div className="brief-row">
                    <span className="brief-key">Assumptions</span>
                    <div className="brief-val">
                      <ul className="brief-list brief-list-assumption">
                        {clarify.assumptions.map((a, i) => (
                          <li key={i}>{a}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>
              )}

              <div className="actions actions-spread">
                <button className="btn btn-ghost" onClick={() => setStep("idea")}>
                  Back to idea
                </button>
                <button className="btn btn-primary" onClick={generate}>
                  Generate PRD
                </button>
              </div>

              {error && (
                <div className="notice notice-error">
                  <span className="notice-label">Error</span>
                  <span>{error}</span>
                </div>
              )}
            </div>
          </div>
        )}

        {step === "generate" && (
          <section className="workspace">
            <div className="ws-bar">
              {generating ? (
                <span className="mono-label" style={{ padding: "14px 0" }}>
                  Writing{" "}
                  {STAGE_UI.find((s) => s.id === active)?.label ?? "plan"} —{" "}
                  {STAGE_ORDER.indexOf(active) + 1} of {STAGE_UI.length}
                  {stageModels[active] ? ` · ${stageModels[active]}` : ""}
                </span>
              ) : (
                <div className="ws-tabs" role="tablist" aria-label="Document sections">
                  {STAGE_UI.map((s, index) => {
                    const st = status[s.id];
                    return (
                      <button
                        key={s.id}
                        role="tab"
                        aria-selected={active === s.id}
                        className={`ws-tab${active === s.id ? " ws-tab-active" : ""}`}
                        onClick={() => {
                          if (editing) setEditing(false);
                          setActive(s.id);
                        }}
                      >
                        <span className="ws-tab-num">
                          {String(index + 1).padStart(2, "0")}
                        </span>
                        {s.label}
                        {st === "running" && <span className="dot-running" />}
                        {st === "done" && !stale[s.id] && <span className="dot-done" />}
                        {stale[s.id] && (
                          <span
                            className="dot-stale"
                            title="An earlier section changed. Regenerate to keep this consistent."
                          />
                        )}
                      </button>
                    );
                  })}
                </div>
              )}

              <div className="ws-actions">
                <span className="spend-line" title="Run cost and tokens so far">
                  Run: {formatUsd(liveCost)} · {formatTokens(runTokens.input)} in /{" "}
                  {formatTokens(runTokens.output)} out
                  {stageModels[active] ? ` · ${stageModels[active]}` : ""}
                </span>
                {generating ? (
                  <button className="btn btn-secondary btn-sm" onClick={stop}>
                    Stop
                  </button>
                ) : (
                  <>
                    {editing ? (
                      <>
                        <button
                          className="btn btn-primary btn-sm"
                          onClick={saveEdits}
                          disabled={savingEdits}
                        >
                          {savingEdits ? "Saving…" : "Save"}
                        </button>
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={() => setEditing(false)}
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={startEdit}
                          disabled={!stages[active] || running}
                        >
                          Edit
                        </button>
                        <button
                          className="btn btn-secondary btn-sm"
                          onClick={() => regenerate(active)}
                          disabled={!canRegenerate}
                        >
                          {busy === active ? "Regenerating…" : "Regenerate"}
                        </button>
                        {saved && (
                          <button className="btn btn-secondary btn-sm" onClick={download}>
                            Download
                          </button>
                        )}
                      </>
                    )}
                  </>
                )}
              </div>
            </div>

            <div className="reader">
              <div className="reader-inner">
                {generating && (
                  <div className="timeline" style={{ marginBottom: 18 }}>
                    {STAGE_UI.map((s, index) => {
                      const st = status[s.id];
                      const isActive = active === s.id && st === "running";
                      return (
                        <div
                          key={s.id}
                          className={`timeline-row${isActive ? " timeline-row-active" : ""}${
                            st === "done" ? " timeline-row-done" : ""
                          }`}
                        >
                          <span className="timeline-index">
                            {String(index + 1).padStart(2, "0")}
                          </span>
                          <div className="timeline-body">
                            <div className="timeline-label">{s.label}</div>
                            <div className="timeline-blurb">{s.blurb}</div>
                            {stageModels[s.id] && (
                              <div className="timeline-model">
                                <code>{stageModels[s.id]}</code>
                                {stageFallback[s.id] ? " (fallback)" : ""}
                              </div>
                            )}
                          </div>
                          <span
                            className={`timeline-status${
                              st === "running"
                                ? " status-running"
                                : st === "done"
                                  ? " status-done"
                                  : ""
                            }`}
                          >
                            {st === "running" ? "Writing" : st === "done" ? "Done" : "Queued"}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}

                {error && (
                  <div className="notice notice-error" style={{ marginBottom: 18 }}>
                    <span className="notice-label">Error</span>
                    <span>{error}</span>
                  </div>
                )}

                {truncated[active] && !generating && (
                  <div className="notice notice-warn" style={{ marginBottom: 18 }}>
                    <span className="notice-label">Truncated</span>
                    <span>
                      This section hit the token limit. Regenerate it to get the
                      complete version.
                    </span>
                  </div>
                )}

                {stale[active] && !editing && !generating && (
                  <div className="notice notice-warn" style={{ marginBottom: 18 }}>
                    <span className="notice-label">Stale</span>
                    <span>
                      An earlier section changed. Regenerate this one so it stays
                      consistent.
                    </span>
                  </div>
                )}

                {!generating && !saved && hasOutput && (
                  <div className="notice notice-warn" style={{ marginBottom: 18 }}>
                    <span className="notice-label">Incomplete</span>
                    <span>
                      This run did not finish, so nothing was saved.{" "}
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => setStep("confirm")}
                      >
                        Back to confirm
                      </button>
                    </span>
                  </div>
                )}

                {editing ? (
                  <textarea
                    className="edit-field"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    spellCheck={false}
                    aria-label="Edit section markdown"
                  />
                ) : stages[active] ? (
                  <div className="reader-paper">
                    <Markdown>{stages[active]}</Markdown>
                  </div>
                ) : (
                  <div className="reader-paper reader-waiting">
                    {status[active] === "running"
                      ? "Writing this section…"
                      : "Waiting for the previous section."}
                  </div>
                )}
              </div>
            </div>
          </section>
        )}
      </div>

      {drawerOpen && (
        <>
          <div
            className="drawer-scrim"
            onClick={() => setDrawerOpen(false)}
            aria-hidden="true"
          />
          <aside className="drawer" role="dialog" aria-label="Project history">
            <div className="drawer-head">
              <div>
                <span className="mono-label">Saved plans</span>
                <div className="mono-value" style={{ marginTop: 4 }}>
                  {projects.length} total
                </div>
              </div>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => setDrawerOpen(false)}
              >
                Close
              </button>
            </div>
            <div className="drawer-body">
              {projects.length === 0 && (
                <p className="drawer-empty">
                  No plans yet. Generated PRDs are saved here automatically.
                </p>
              )}
              {projects.map((p) => (
                <div key={p.id} className="drawer-row">
                  <Link
                    href={`/projects/${p.id}`}
                    className="drawer-link"
                    onClick={() => setDrawerOpen(false)}
                  >
                    <div className="drawer-title">{p.title}</div>
                    <div className="drawer-meta">
                      {formatDate(p.createdAt)} ·{" "}
                      {p.profile ? PROFILE_LABELS[p.profile] : "Legacy"} ·{" "}
                      {formatUsd(p.costUsd)}
                    </div>
                  </Link>
                  <button
                    className="btn btn-danger-ghost"
                    onClick={() => remove(p.id, p.title)}
                  >
                    Delete
                  </button>
                </div>
              ))}
            </div>
          </aside>
        </>
      )}
    </div>
  );
}

function QuestionCard({
  index,
  question,
  value,
  note,
  onSingle,
  onToggle,
  onNote,
}: {
  index: number;
  question: ClarifyQuestion;
  value: string | string[] | undefined;
  note: string;
  onSingle: (value: string) => void;
  onToggle: (value: string) => void;
  onNote: (value: string) => void;
}) {
  const selected = Array.isArray(value) ? value : value ? [value] : [];
  const answered = selected.length > 0 || note.trim().length > 0;
  const multi = question.type === "multiple";

  return (
    <div className={`question${answered ? " question-answered" : ""}`}>
      <div className="question-meta">
        <span className="tag">{String(index + 1).padStart(2, "0")}</span>
        <span className="tag">{question.category}</span>
        {question.required && <span className="tag tag-required">Key decision</span>}
        {answered && <span className="tag tag-answered">Answered</span>}
      </div>

      <p className="question-text">{question.question}</p>
      {question.reason && <p className="question-reason">{question.reason}</p>}

      {question.type === "text" ? (
        <textarea
          className="text-input"
          style={{ marginTop: 12, minHeight: 78 }}
          value={note}
          placeholder="Your answer"
          onChange={(e) => onNote(e.target.value)}
        />
      ) : (
        <>
          <div className="options" role={multi ? "group" : "radiogroup"}>
            {question.options?.map((opt) => {
              const isOn = selected.includes(opt.value);
              const isRec = question.recommendedOption === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  role={multi ? "checkbox" : "radio"}
                  aria-checked={isOn}
                  className={`option${isOn ? " option-selected" : ""}`}
                  onClick={() =>
                    multi ? onToggle(opt.value) : onSingle(opt.value)
                  }
                >
                  <span
                    className={`option-box${multi ? "" : " option-box-round"}`}
                    aria-hidden="true"
                  >
                    {isOn ? "✓" : ""}
                  </span>
                  <span className="option-body">
                    <span className="option-label">
                      {opt.label}
                      {isRec && <span className="option-rec">Recommended</span>}
                    </span>
                    {opt.description && (
                      <span className="option-desc" style={{ display: "block" }}>
                        {opt.description}
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
          <input
            className="other-input"
            value={note}
            placeholder="Or describe your own answer"
            onChange={(e) => onNote(e.target.value)}
          />
        </>
      )}
    </div>
  );
}
