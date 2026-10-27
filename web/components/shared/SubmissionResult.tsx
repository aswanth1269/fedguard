"use client";

import { CheckList, HashValue, OutcomeBadge, outcomeLabel, outcomeTone } from "@/components/shared/Integrity";
import type { SubmissionResponse } from "@/lib/api";

const APPROVAL_TEXT: Record<string, string> = {
  accepted: "Accepted - recorded as a new trusted version.",
  quarantined: "Quarantined - recorded, but excluded from the trusted latest version until reviewed.",
  pending_review: "Pending review - recorded, but there is not enough evidence to accept it yet.",
  rejected: "Rejected - logged as an attempt. Nothing was stored and no version number was used.",
  "n/a": "No new version - the content is identical to one already on record.",
};

const CHANNEL_TEXT: Record<string, string> = {
  demo_signer: "Signed server-side by the simulated bank's key (demo signer).",
  demo_signer_upload: "Your file, signed server-side by the simulated bank's key (demo signer).",
  api_submission: "Signed by the submitter's own key off-server.",
  in_process_simulation: "Produced by the in-process training simulation.",
};

/** Renders exactly what the backend's decision engine returned. */
export function SubmissionResult({ result }: { result: SubmissionResponse }) {
  const tone = outcomeTone(result.outcome);
  const border =
    tone === "good"
      ? "border-[var(--status-good)]/40"
      : tone === "critical"
        ? "border-[var(--status-critical)]/40"
        : tone === "warning"
          ? "border-[var(--status-warning)]/40"
          : "border-[var(--status-info)]/40";
  const rec = result.record;
  return (
    <div className={`p-4 rounded-xl border ${border} bg-[var(--glass-subtle)] space-y-3`}>
      <div className="flex flex-wrap items-center gap-2">
        <OutcomeBadge outcome={result.outcome} size="md" />
        <span className="text-[13px] font-semibold text-[var(--ink-primary)]">{outcomeLabel(result.outcome)}</span>
      </div>
      <p className="text-[12.5px] text-[var(--ink-secondary)]">
        {APPROVAL_TEXT[result.approval_status] ?? result.approval_status}{" "}
        {CHANNEL_TEXT[result.channel] ?? ""}
      </p>
      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-[12px]">
        <div className="flex gap-1">
          <dt className="text-[var(--ink-muted)]">Artifact:</dt>
          <dd className="font-mono">{rec.artifact_id}</dd>
        </div>
        <div className="flex gap-1">
          <dt className="text-[var(--ink-muted)]">Version:</dt>
          <dd className="font-mono">{rec.version != null ? `v${rec.version}` : "none (not registered)"}</dd>
        </div>
        <div className="flex gap-1 items-center min-w-0">
          <dt className="text-[var(--ink-muted)] shrink-0">Content hash:</dt>
          <dd className="min-w-0"><HashValue hash={rec.content_hash} label="content hash" /></dd>
        </div>
        {rec.trusted_hash && (
          <div className="flex gap-1 items-center min-w-0">
            <dt className="text-[var(--ink-muted)] shrink-0">
              Trusted hash{rec.claimed_version != null ? ` (v${rec.claimed_version})` : ""}:
            </dt>
            <dd className="min-w-0"><HashValue hash={rec.trusted_hash} label="trusted hash" /></dd>
          </div>
        )}
        <div className="flex gap-1">
          <dt className="text-[var(--ink-muted)]">Registry record:</dt>
          <dd className="font-mono">#{rec.seq} (local registry, not on-chain)</dd>
        </div>
      </dl>
      <CheckList checks={result.checks} />
      {result.reasons.length > 0 && (
        <ul className="text-[12px] text-[var(--ink-secondary)] list-disc pl-5">
          {result.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
