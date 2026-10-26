import Link from "next/link";
import { notFound } from "next/navigation";
import { DownloadButton } from "@/components/DownloadButton";
import { Markdown } from "@/components/Markdown";
import { formatUsd } from "@/lib/format";
import { PROFILE_LABELS, ROLE_IDS, ROLE_SHORT_LABELS } from "@/lib/labels";
import { PRESETS } from "@/lib/presets";
import { getProject } from "@/lib/store";

export const dynamic = "force-dynamic";

function formatDate(value: string) {
  return new Date(value).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const project = getProject(id);
  if (!project) notFound();

  const filename = `${project.title
    .replace(/[^a-z0-9]+/gi, "-")
    .toLowerCase()}.md`;

  const presetLabel = PRESETS.find((p) => p.id === project.preset)?.label;
  const roleModels = ROLE_IDS.filter((role) => project.models[role]).map(
    (role) => [role, project.models[role]] as const,
  );
  const brief = project.brief;
  const decisions = brief?.answers.filter((a) => !a.skipped && a.answer) ?? [];
  const skipped = brief?.answers.filter((a) => a.skipped) ?? [];

  return (
    <div className="app">
      <header className="topbar">
        <div className="wordmark">
          <Link href="/" className="wordmark-name" style={{ textDecoration: "none" }}>
            PRD Studio
          </Link>
          <span className="wordmark-rule" aria-hidden="true" />
          <span className="mono-label">saved plan</span>
        </div>
        <div className="topbar-right">
          <Link href="/" className="btn btn-ghost btn-sm">
            Back to workspace
          </Link>
          <DownloadButton content={project.content} filename={filename} />
        </div>
      </header>

      <div className="page">
        <div className="page-inner">
          <div className="doc-head">
            <span className="mono-label">Generated plan</span>
            <h1 className="doc-title">{project.title}</h1>
            <div className="doc-meta">
              <span className="doc-meta-item">
                <span className="mono-label">Created</span>
                <span className="mono-value">{formatDate(project.createdAt)}</span>
              </span>
              <span className="doc-meta-item">
                <span className="mono-label">Profile</span>
                <span className="mono-value">
                  {project.profile ? PROFILE_LABELS[project.profile] : "Legacy"}
                </span>
              </span>
              <span className="doc-meta-item">
                <span className="mono-label">Cost</span>
                <span className="mono-value">{formatUsd(project.costUsd)}</span>
              </span>
              <span className="doc-meta-item">
                <span className="mono-label">Language</span>
                <span className="mono-value">{project.language}</span>
              </span>
              {presetLabel && (
                <span className="doc-meta-item">
                  <span className="mono-label">Platform</span>
                  <span className="mono-value">{presetLabel}</span>
                </span>
              )}
            </div>
            {roleModels.length > 0 && (
              <div className="doc-models">
                <span className="mono-label">Models</span>
                <div className="doc-model-list">
                  {roleModels.map(([role, model]) => (
                    <span key={role} className="doc-model">
                      <span className="doc-model-role">
                        {ROLE_SHORT_LABELS[role]}
                      </span>
                      <code>{model}</code>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {brief && (brief.summary || decisions.length > 0 || skipped.length > 0) && (
            <div className="brief-grid" style={{ marginBottom: 30 }}>
              {brief.summary && (
                <div className="brief-row">
                  <span className="brief-key">Understood as</span>
                  <div className="brief-val">{brief.summary}</div>
                </div>
              )}
              {decisions.length > 0 && (
                <div className="brief-row">
                  <span className="brief-key">Your decisions</span>
                  <div className="brief-val">
                    <ul className="brief-list">
                      {decisions.map((a) => (
                        <li key={a.id}>
                          <span>
                            {a.question} — <strong>{a.answer}</strong>
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}
              {skipped.length > 0 && (
                <div className="brief-row">
                  <span className="brief-key">Assumed</span>
                  <div className="brief-val brief-val-quiet">
                    <ul className="brief-list brief-list-assumption">
                      {skipped.map((a) => (
                        <li key={a.id}>{a.question}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="reader-paper">
            <Markdown>{project.content}</Markdown>
          </div>
        </div>
      </div>
    </div>
  );
}
