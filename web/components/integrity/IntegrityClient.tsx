"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowClockwise,
  ArrowCounterClockwise,
  DownloadSimple,
  Fingerprint,
  LinkSimple,
  LockKey,
  ShieldCheck,
  ShieldWarning,
  UploadSimple,
  Warning,
} from "@phosphor-icons/react";
import { GlassBadge } from "@/components/ui/GlassBadge";
import { GlassButton } from "@/components/ui/GlassButton";
import { GlassCard } from "@/components/ui/GlassCard";
import { ChainVerificationBanner } from "@/components/audit/ChainVerificationBanner";
import { LedgerTimeline } from "@/components/audit/LedgerTimeline";
import { HashValue, OutcomeBadge, PageHeader, SourceNote } from "@/components/shared/Integrity";
import {
  api,
  artifactDownloadUrl,
  fileToBase64,
  formatTimestamp,
  type ApiResult,
  type ArtifactRecord,
  type IntegrityStatus,
  type LedgerResponse,
  type VerifyArtifactResponse,
  type VerifyResult,
} from "@/lib/api";

const TYPE_LABEL: Record<string, string> = {
  model_update: "Bank model update",
  global_model: "Global model",
  dataset: "Dataset (file hash)",
};

/**
 * First value of the first array in an .npz file. numpy's savez writes an
 * uncompressed (stored) zip, so the .npy bytes follow the local file header.
 * This only DISPLAYS the stored value; hashing and comparison stay on the server.
 */
function readFirstNpzValue(buf: ArrayBuffer): number {
  const dv = new DataView(buf);
  if (dv.getUint32(0, true) !== 0x04034b50) throw new Error("not a zip file");
  if (dv.getUint16(8, true) !== 0) throw new Error("compressed .npz is not supported");
  let p = 30 + dv.getUint16(26, true) + dv.getUint16(28, true);
  if (dv.getUint8(p) !== 0x93) throw new Error("not a .npy entry");
  const major = dv.getUint8(p + 6);
  const headerLen = major === 1 ? dv.getUint16(p + 8, true) : dv.getUint32(p + 8, true);
  const headerStart = p + (major === 1 ? 10 : 12);
  const header = new TextDecoder().decode(new Uint8Array(buf, headerStart, headerLen));
  const m = /'descr':\s*'([<>|=]?)f(4|8)'/.exec(header);
  if (!m || m[1] === ">") throw new Error("unsupported dtype");
  p = headerStart + headerLen;
  return m[2] === "4" ? dv.getFloat32(p, true) : dv.getFloat64(p, true);
}

function StatusTile({
  title,
  ok,
  label,
  detail,
}: {
  title: string;
  ok: boolean | null;
  label: string;
  detail: string;
}) {
  const tone = ok === true ? "good" : ok === false ? "critical" : "neutral";
  return (
    <div className="glass-card p-4 space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12px] font-medium text-[var(--ink-secondary)]">{title}</span>
        <GlassBadge tone={tone} size="sm">{label}</GlassBadge>
      </div>
      <p className="text-[12px] text-[var(--ink-muted)] leading-relaxed">{detail}</p>
    </div>
  );
}

function HashComparison({ result }: { result: VerifyArtifactResponse }) {
  const same = result.trusted_hash === result.candidate_hash;
  return (
    <div
      className={`p-4 rounded-xl border space-y-3 ${
        result.outcome === "INTEGRITY_VERIFIED"
          ? "border-[var(--status-good)]/40 bg-[var(--status-good)]/5"
          : "border-[var(--status-critical)]/40 bg-[var(--status-critical)]/5"
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        {result.outcome === "INTEGRITY_VERIFIED" ? (
          <ShieldCheck size={22} weight="fill" className="text-[var(--status-good)]" />
        ) : (
          <ShieldWarning size={22} weight="fill" className="text-[var(--status-critical)]" />
        )}
        <span className="text-[15px] font-bold text-[var(--ink-primary)]">
          {result.outcome === "INTEGRITY_VERIFIED" ? "Integrity Verified" : result.outcome === "INTEGRITY_FAILURE" ? "Integrity Failure" : "Verification failed"}
        </span>
        <OutcomeBadge outcome={result.outcome} />
        <span className="text-[12px] text-[var(--ink-muted)]">
          checked {result.candidate_origin.replace("_", " ")} against v{result.version} · audit record #{result.verification_seq}
        </span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="p-3 rounded-lg bg-[var(--glass-subtle)] border border-[var(--glass-border)] space-y-1">
          <div className="text-[11px] uppercase tracking-wider text-[var(--ink-muted)]">Trusted hash (v{result.version} record)</div>
          <HashValue hash={result.trusted_hash} label="trusted hash" full />
        </div>
        <div
          className={`p-3 rounded-lg border space-y-1 ${
            same ? "bg-[var(--glass-subtle)] border-[var(--glass-border)]" : "bg-[var(--status-critical)]/10 border-[var(--status-critical)]/30"
          }`}
        >
          <div className="text-[11px] uppercase tracking-wider text-[var(--ink-muted)]">Recalculated hash ({result.candidate_origin.replace("_", " ")})</div>
          <HashValue hash={result.candidate_hash} label="recalculated hash" full />
        </div>
      </div>
      <p className="text-[12px] text-[var(--ink-secondary)]">
        Compared on the full 64-character SHA-256 digest.
        {result.reasons.length > 0 && ` ${result.reasons.join(" ")}`}
      </p>
    </div>
  );
}

export function IntegrityClient() {
  const [status, setStatus] = useState<IntegrityStatus | null>(null);
  const [records, setRecords] = useState<ArtifactRecord[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [verifyResult, setVerifyResult] = useState<ApiResult<VerifyResult> | null>(null);
  const [ledger, setLedger] = useState<LedgerResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const reload = useCallback(() => setRefreshKey((k) => k + 1), []);

  const [selectedSeq, setSelectedSeq] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [check, setCheck] = useState<VerifyArtifactResponse | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [originalValue, setOriginalValue] = useState<number | null>(null);
  const [modifiedValue, setModifiedValue] = useState("");
  const [valueError, setValueError] = useState<string | null>(null);
  const [datasetChanged, setDatasetChanged] = useState(false);
  const [historyFilter, setHistoryFilter] = useState<"versions" | "all">("versions");

  useEffect(() => {
    let alive = true;
    (async () => {
      const [s, a, v, l] = await Promise.all([api.integrityStatus(), api.artifacts(), api.verify(), api.ledger()]);
      if (!alive) return;
      setOffline(!s.ok && s.kind === "offline");
      if (s.ok) setStatus(s.data);
      if (a.ok) {
        setRecords(a.data.records);
        setLoadError(null);
      } else {
        setLoadError(a.message);
      }
      setVerifyResult(v);
      if (l.ok) setLedger(l.data);
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [refreshKey]);

  const versions = useMemo(() => records.filter((r) => r.kind === "version"), [records]);
  // Default selection for the demo: Bank C's first recorded model update.
  const defaultSeq = useMemo(() => {
    const bankC = versions.filter((r) => r.owner === "bank_2" && r.artifact_type === "model_update");
    return (bankC[0] ?? versions.find((r) => r.artifact_type === "model_update") ?? versions[0])?.seq ?? null;
  }, [versions]);
  const seq = selectedSeq ?? defaultSeq;
  const selected = versions.find((r) => r.seq === seq) ?? null;
  const laterVersions = selected
    ? versions.filter((r) => r.artifact_id === selected.artifact_id && (r.version ?? 0) > (selected.version ?? 0))
    : [];
  const firstTensor = selected?.schema?.tensors?.[0]?.name ?? null;
  const originalText = originalValue != null ? originalValue.toPrecision(7) : "";
  const isModelArtifact = selected != null && selected.artifact_type !== "dataset";

  // Original Value: read from the stored artifact itself, never invented.
  const selectedKey = selected ? `${selected.seq}:${selected.artifact_type}` : null;
  useEffect(() => {
    if (!selectedKey) return;
    const [seqText, type] = selectedKey.split(":");
    let alive = true;
    (async () => {
      if (type === "dataset") {
        if (!alive) return;
        setOriginalValue(null);
        setModifiedValue("");
        setValueError(null);
        setDatasetChanged(false);
        return;
      }
      try {
        const res = await fetch(artifactDownloadUrl(Number(seqText)), { cache: "no-store" });
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        const value = readFirstNpzValue(await res.arrayBuffer());
        if (!alive) return;
        setOriginalValue(value);
        setModifiedValue(value.toPrecision(7));
        setValueError(null);
      } catch (err) {
        if (!alive) return;
        setOriginalValue(null);
        setModifiedValue("");
        setValueError(`Could not read the stored value: ${err instanceof Error ? err.message : String(err)}`);
      }
    })();
    return () => {
      alive = false;
    };
  }, [selectedKey]);

  const select = (value: number) => {
    setSelectedSeq(value);
    setCheck(null);
    setActionError(null);
  };

  // Test Integrity: unchanged -> re-hash the stored artifact; changed -> the
  // server applies the difference to the first value of a TEMPORARY copy and
  // re-hashes that. The stored artifact and its record are never modified.
  const testIntegrity = async () => {
    if (!selected) return;
    if (!isModelArtifact) {
      await runVerify(datasetChanged ? "modified_copy" : "stored");
      return;
    }
    if (originalValue == null) return;
    const typed = modifiedValue.trim();
    if (typed === originalText) {
      await runVerify("stored");
      return;
    }
    const target = Number(typed);
    if (typed === "" || !Number.isFinite(target)) {
      setActionError("Modified Value must be a number.");
      return;
    }
    await runVerify("modified_copy", undefined, target - originalValue);
  };

  const resetChanges = () => {
    setModifiedValue(originalText);
    setDatasetChanged(false);
    setCheck(null);
    setActionError(null);
  };

  const runVerify = async (source: "stored" | "modified_copy" | "upload", file?: File, delta?: number) => {
    if (!selected) return;
    setBusy(source === "upload" ? "upload" : "test");
    setActionError(null);
    const res = await api.verifyArtifact(selected.seq, {
      source,
      tensor_index: 0,
      delta: delta ?? 0,
      upload_b64: file ? await fileToBase64(file) : undefined,
    });
    setBusy(null);
    if (res.ok) {
      setCheck(res.data);
      reload();
    } else {
      setCheck(null);
      setActionError(res.message);
    }
  };

  const history = historyFilter === "versions" ? versions : records;
  const chain = status?.blockchain;

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 space-y-8">
      <PageHeader
        icon={<Fingerprint size={22} />}
        title="Integrity & Audit"
        description={
          <>
            Every bank update, global model and registered dataset is stored with its full SHA-256 hash, signer, version
            and validation result. Old versions are never overwritten. Check whether any copy still matches its trusted
            record, and see how new versions, tampering and unauthorized submissions are told apart.
          </>
        }
      >
        <GlassButton variant="glass" size="sm" onClick={reload} icon={<ArrowClockwise size={14} />}>
          Refresh
        </GlassButton>
      </PageHeader>

      {offline ? (
        <GlassCard className="p-6 text-[13px] text-[var(--status-critical)]">
          The FedGuard API is not reachable, so no integrity data can be shown. Start the backend and refresh.
        </GlassCard>
      ) : (
        <>
          {/* What is actually protecting the records */}
          <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <StatusTile
              title="Artifact registry (local)"
              ok={status ? status.artifact_registry.ok : null}
              label={status ? (status.artifact_registry.ok ? "CHAIN INTACT" : "TAMPERED") : "…"}
              detail={
                status
                  ? status.artifact_registry.ok
                    ? `${status.artifact_registry.entries_checked} records, hash-linked and re-verified.`
                    : `Broken at record #${status.artifact_registry.failed_at_seq}: ${status.artifact_registry.reason}`
                  : "Checking…"
              }
            />
            <StatusTile
              title="Round ledger (local hash chain)"
              ok={status ? status.round_ledger.ok : null}
              label={status ? (status.round_ledger.ok ? "CHAIN INTACT" : status.round_ledger.ok === false ? "TAMPERED" : "UNKNOWN") : "…"}
              detail={
                status
                  ? status.round_ledger.ok
                    ? `${status.round_ledger.entries_checked} round entries verified by GET /verify.`
                    : status.round_ledger.reason ?? status.round_ledger.detail ?? ""
                  : "Checking…"
              }
            />
            <StatusTile
              title="Submission signatures"
              ok={status ? status.signatures.available : null}
              label={status ? (status.signatures.available ? "ED25519 ACTIVE" : "UNAVAILABLE") : "…"}
              detail={
                status
                  ? status.signatures.available
                    ? `${status.signatures.trusted_keys} trusted keys (${status.signatures.simulated_custody ?? 0} simulated, ${status.signatures.external_custody ?? 0} external).`
                    : status.signatures.detail ?? ""
                  : "Checking…"
              }
            />
            <StatusTile
              title="Blockchain anchoring"
              ok={chain ? (chain.status === "connected" ? true : chain.status === "unreachable" ? false : null) : null}
              label={chain ? (chain.status === "connected" ? "CONNECTED" : chain.status === "unreachable" ? "UNREACHABLE" : "NOT CONFIGURED") : "…"}
              detail={chain ? chain.detail : "Checking…"}
            />
          </section>

          {status?.demo_signer_enabled && (
            <div className="p-4 rounded-xl bg-[var(--status-warning)]/10 border border-[var(--status-warning)]/30 flex gap-2.5 text-[12.5px] text-[var(--ink-primary)]">
              <Warning size={18} className="shrink-0 text-[var(--status-warning)]" />
              <span>
                <strong>Demo signer active.</strong> The simulated banks&apos; private keys are held by this server so the
                demo can sign for them. A signature from such a key proves less than one from a key the bank keeps itself.
                In a real deployment each bank signs locally and this is disabled with{" "}
                <code className="font-mono">FEDGUARD_DEMO_SIGNER=0</code>.
              </span>
            </div>
          )}

          {/* The demo flow */}
          <GlassCard variant="elevated" glow="cyan" className="p-5 sm:p-7 space-y-6" id="verify-demo">
            <div className="flex items-center gap-2 flex-wrap">
              <LockKey size={20} className="text-[var(--accent-cyan)]" />
              <h2 className="text-lg font-bold text-[var(--ink-primary)]">Verify a contribution against its trusted record</h2>
            </div>

            {loading ? (
              <p className="text-[13px] text-[var(--ink-muted)]">Loading the artifact registry…</p>
            ) : loadError ? (
              <p className="text-[13px] text-[var(--status-critical)]">{loadError}</p>
            ) : versions.length === 0 ? (
              <p className="text-[13px] text-[var(--ink-secondary)]">
                No artifacts are recorded yet. Initialize the model on the Live Fraud Monitor page. When its training run
                completes, each bank&apos;s final update and the global model are registered here.
              </p>
            ) : (
              <>
                {/* Step 1 */}
                <div className="space-y-2">
                  <label htmlFor="artifact-select" className="text-[12px] font-semibold uppercase tracking-wider text-[var(--ink-muted)]">
                    1. Select Artifact
                  </label>
                  <select
                    id="artifact-select"
                    value={seq ?? ""}
                    onChange={(e) => select(Number(e.target.value))}
                    className="w-full md:w-auto px-3 py-2 rounded-lg bg-[var(--glass-subtle)] border border-[var(--glass-border)] text-[13px] text-[var(--ink-primary)]"
                  >
                    {versions.map((r) => (
                      <option key={r.seq} value={r.seq}>
                        {r.owner_display} · {TYPE_LABEL[r.artifact_type]} · v{r.version}
                        {r.round != null ? ` · round ${r.round}` : ""} · {r.approval_status}
                      </option>
                    ))}
                  </select>
                </div>

                {selected && (
                  <>
                    {/* Step 2 */}
                    <div className="space-y-2">
                      <div className="text-[12px] font-semibold uppercase tracking-wider text-[var(--ink-muted)]">2. Trusted record</div>
                      <div className="p-4 rounded-xl bg-[var(--glass-subtle)] border border-[var(--glass-border)] space-y-3">
                        <div className="space-y-1">
                          <div className="text-[11px] text-[var(--ink-muted)]">
                            Full SHA-256 ({selected.hash_scheme}) - the value every check is compared with
                          </div>
                          <HashValue hash={selected.content_hash} label="trusted hash" full />
                        </div>
                        <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-1.5 text-[12px]">
                          <div><dt className="inline text-[var(--ink-muted)]">Artifact: </dt><dd className="inline font-mono">{selected.artifact_id}</dd></div>
                          <div><dt className="inline text-[var(--ink-muted)]">Version: </dt><dd className="inline font-mono">v{selected.version}{selected.round != null ? ` (round ${selected.round})` : ""}</dd></div>
                          <div><dt className="inline text-[var(--ink-muted)]">Recorded: </dt><dd className="inline">{formatTimestamp(selected.timestamp)}</dd></div>
                          <div><dt className="inline text-[var(--ink-muted)]">Submitted by: </dt><dd className="inline font-mono">{selected.submitted_by ?? "—"} via {selected.channel}</dd></div>
                          <div><dt className="inline text-[var(--ink-muted)]">Signature: </dt><dd className="inline">{selected.signature?.status} ({selected.signature?.key_id}, {selected.signature?.custody === "simulated_server_side" ? "simulated key" : "external key"})</dd></div>
                          <div><dt className="inline text-[var(--ink-muted)]">Validation: </dt><dd className="inline">{selected.decision && <OutcomeBadge outcome={selected.decision.outcome} />} {selected.approval_status}</dd></div>
                          <div><dt className="inline text-[var(--ink-muted)]">Previous version: </dt><dd className="inline font-mono">{selected.previous_version_ref ? `v${selected.previous_version_ref.version} (#${selected.previous_version_ref.seq})` : "none (first version)"}</dd></div>
                          <div><dt className="inline text-[var(--ink-muted)]">Stored in: </dt><dd className="inline">local artifact registry, record #{selected.seq}. <strong>Not on-chain.</strong></dd></div>
                          {selected.defense_evidence && (
                            <div className="sm:col-span-2 lg:col-span-3"><dt className="inline text-[var(--ink-muted)]">Defense evidence: </dt><dd className="inline">{selected.defense_evidence.detail}</dd></div>
                          )}
                          {selected.ledger_ref && (
                            <div className="sm:col-span-2 lg:col-span-3 flex flex-wrap items-center gap-1">
                              <LinkSimple size={13} className="text-[var(--accent-cyan)]" />
                              <dt className="text-[var(--ink-muted)]">Round ledger entry #{selected.ledger_ref.ledger_index}:</dt>
                              <dd className="flex items-center gap-1">
                                <HashValue hash={selected.ledger_ref.entry_hash} label="ledger entry hash" />
                                <span>{selected.ledger_ref.legacy_hash_matches ? "- ledger's model hash matches these weights" : "- ledger model hash does NOT match"}</span>
                              </dd>
                            </div>
                          )}
                        </dl>
                        {laterVersions.length > 0 && (
                          <p className="text-[12px] text-[var(--accent-cyan)]">
                            Later versions of this artifact exist ({laterVersions.map((v) => `v${v.version}`).join(", ")}). This record still keeps its own original hash.
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Steps 3-7 */}
                    <div className="space-y-3">
                      <div className="text-[12px] font-semibold uppercase tracking-wider text-[var(--ink-muted)]">3-7. Check a copy against this record</div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-w-2xl text-[12.5px]">
                        <div className="space-y-1">
                          <span className="block text-[var(--ink-muted)]">Original Value</span>
                          <div className="px-3 py-2 rounded-lg bg-[var(--glass-subtle)] border border-[var(--glass-border)] font-mono text-[var(--ink-primary)]">
                            {isModelArtifact ? (originalValue != null ? originalText : valueError ? "unavailable" : "reading…") : "first transaction amount (stays on the server)"}
                          </div>
                          <span className="block text-[11px] text-[var(--ink-muted)]">
                            {isModelArtifact
                              ? `First value of ${firstTensor ?? "the first tensor"}, read from the stored artifact`
                              : "Dataset contents are never sent to the browser"}
                          </span>
                        </div>
                        <label className="space-y-1">
                          <span className="block text-[var(--ink-muted)]">Modified Value</span>
                          {isModelArtifact ? (
                            <input
                              type="text"
                              inputMode="decimal"
                              value={modifiedValue}
                              disabled={originalValue == null}
                              onChange={(e) => setModifiedValue(e.target.value)}
                              className="w-full px-3 py-2 rounded-lg bg-[var(--glass-subtle)] border border-[var(--glass-border)] font-mono text-[var(--ink-primary)]"
                            />
                          ) : (
                            <select
                              value={datasetChanged ? "plus1" : "same"}
                              onChange={(e) => setDatasetChanged(e.target.value === "plus1")}
                              className="w-full px-3 py-2 rounded-lg bg-[var(--glass-subtle)] border border-[var(--glass-border)] text-[var(--ink-primary)]"
                            >
                              <option value="same">Unchanged</option>
                              <option value="plus1">Original amount + 1</option>
                            </select>
                          )}
                          <span className="block text-[11px] text-[var(--ink-muted)]">Applied to a temporary copy only</span>
                        </label>
                      </div>
                      {valueError && <p className="text-[12px] text-[var(--status-critical)]">{valueError}</p>}
                      <div className="flex flex-wrap items-end gap-3">
                        <GlassButton
                          variant="primary"
                          size="md"
                          loading={busy === "test"}
                          disabled={isModelArtifact && originalValue == null}
                          onClick={testIntegrity}
                          icon={<ShieldCheck size={16} />}
                        >
                          Test Integrity
                        </GlassButton>
                        <GlassButton variant="glass" size="md" onClick={resetChanges} icon={<ArrowCounterClockwise size={16} />}>
                          Reset Changes
                        </GlassButton>
                        <label className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-[13px] font-medium bg-[var(--glass-elevated)] border border-[var(--glass-border)] text-[var(--ink-primary)] hover:border-[var(--accent-cyan)] cursor-pointer">
                          <UploadSimple size={16} />
                          Check my file
                          <input
                            type="file"
                            className="sr-only"
                            accept={selected.artifact_type === "dataset" ? ".csv" : ".npz"}
                            onChange={(e) => {
                              const f = e.target.files?.[0];
                              if (f) runVerify("upload", f);
                              e.target.value = "";
                            }}
                          />
                        </label>
                        {selected.artifact_type !== "dataset" && (
                          <a
                            href={artifactDownloadUrl(selected.seq)}
                            className="inline-flex items-center gap-1.5 px-3 py-2 text-[12.5px] text-[var(--accent-cyan)] hover:underline"
                          >
                            <DownloadSimple size={15} /> Download this version (.npz)
                          </a>
                        )}
                      </div>
                      <SourceNote>
                        Test Integrity re-hashes the content on the server and compares it with the trusted hash above. A changed
                        value is applied only to a temporary copy; the stored artifact and its record are never modified. Every
                        check is itself logged in the registry.
                      </SourceNote>
                      {check && <HashComparison result={check} />}
                    </div>

                    {actionError && <p className="text-[12.5px] text-[var(--status-critical)]">{actionError}</p>}
                  </>
                )}
              </>
            )}
          </GlassCard>

          {/* Version history */}
          <GlassCard className="overflow-hidden">
            <div className="p-5 border-b border-[var(--glass-border)] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-bold text-[var(--ink-primary)]">Version history &amp; audit records</h2>
                <p className="text-[12px] text-[var(--ink-muted)]">
                  Append-only and hash-linked. A new version is a new row that points at the previous one.
                </p>
              </div>
              <div className="flex rounded-xl bg-[var(--glass-subtle)] border border-[var(--glass-border)] p-0.5 text-[12px]">
                {(["versions", "all"] as const).map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setHistoryFilter(f)}
                    className={`px-3 py-1 rounded-lg cursor-pointer ${historyFilter === f ? "bg-[var(--accent-cyan)] text-white" : "text-[var(--ink-secondary)]"}`}
                  >
                    {f === "versions" ? "Versions only" : "Everything (incl. rejected & checks)"}
                  </button>
                ))}
              </div>
            </div>
            {history.length === 0 ? (
              <p className="p-6 text-[13px] text-[var(--ink-muted)]">No records yet.</p>
            ) : (
              <div className="overflow-auto max-h-[480px]">
                <table className="w-full text-[12px]">
                  <thead className="sticky top-0 z-10 backdrop-blur-xl text-[11px] uppercase tracking-wider text-[var(--ink-muted)] bg-[var(--glass-subtle)]">
                    <tr>
                      <th className="text-left px-3 py-2.5">#</th>
                      <th className="text-left px-3 py-2.5">Time</th>
                      <th className="text-left px-3 py-2.5">Record</th>
                      <th className="text-left px-3 py-2.5">Owner · type</th>
                      <th className="text-left px-3 py-2.5">Version</th>
                      <th className="text-left px-3 py-2.5">Hash</th>
                      <th className="text-left px-3 py-2.5">Outcome</th>
                      <th className="text-left px-3 py-2.5">Signature</th>
                      <th className="text-left px-3 py-2.5">Where</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...history].reverse().map((r) => (
                      <tr
                        key={r.seq}
                        className={`border-t border-[var(--glass-border)] ${r.kind === "version" ? "hover:bg-[var(--glass-subtle)] cursor-pointer" : ""} ${r.seq === seq ? "bg-[var(--accent-cyan)]/5" : ""}`}
                        onClick={() => r.kind === "version" && select(r.seq)}
                      >
                        <td className="px-3 py-2 font-mono">{r.seq}</td>
                        <td className="px-3 py-2 whitespace-nowrap text-[var(--ink-secondary)]">{new Date(r.timestamp * 1000).toLocaleTimeString()}</td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          {r.kind === "version" ? "version" : r.kind === "rejected_submission" ? "rejected attempt" : `check of v${r.verified_version}`}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">{r.owner_display} · {TYPE_LABEL[r.artifact_type] ?? r.artifact_type}</td>
                        <td className="px-3 py-2 font-mono whitespace-nowrap">
                          {r.version != null ? `v${r.version}` : "—"}
                          {r.previous_version_ref && <span className="text-[var(--ink-muted)]"> ← v{r.previous_version_ref.version}</span>}
                        </td>
                        <td className="px-3 py-2"><HashValue hash={r.content_hash} label="hash" /></td>
                        <td className="px-3 py-2">
                          {r.decision ? <OutcomeBadge outcome={r.decision.outcome} /> : "—"}
                          {r.approval_status && r.kind === "version" && <span className="block text-[10.5px] text-[var(--ink-muted)]">{r.approval_status}</span>}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">{r.signature?.status ?? "—"}</td>
                        <td className="px-3 py-2 whitespace-nowrap text-[var(--ink-muted)]">local registry</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </GlassCard>

          {/* Round ledger (existing components) */}
          <section className="space-y-4">
            <div>
              <h2 className="text-lg font-bold text-[var(--ink-primary)]">Round decision ledger</h2>
              <p className="text-[12.5px] text-[var(--ink-secondary)]">
                One entry per training round: the global model hash, the defense&apos;s decision, reputations and the agent
                verdict, each linked to the previous entry by hash.{" "}
                {chain?.status === "connected"
                  ? "Commitments are also anchored on-chain, and GET /verify checks them."
                  : "Entries are local only. Nothing is anchored on-chain while the blockchain is not configured."}
              </p>
            </div>
            <ChainVerificationBanner result={verifyResult} loading={loading} onRefresh={reload} />
            <LedgerTimeline entries={ledger?.entries ?? []} loading={loading} />
          </section>

          {/* Honest limitations */}
          {status && (
            <GlassCard className="p-5 space-y-2">
              <h2 className="text-[14px] font-bold text-[var(--ink-primary)]">Trust model and limits</h2>
              <ul className="list-disc pl-5 space-y-1 text-[12.5px] text-[var(--ink-secondary)]">
                {status.trust_model.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            </GlassCard>
          )}

        </>
      )}
    </div>
  );
}
