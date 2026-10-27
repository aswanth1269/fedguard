"use client";

import { useCallback, useEffect, useState } from "react";
import { Buildings, Database, FileArrowUp, Gear } from "@phosphor-icons/react";
import { GlassBadge } from "@/components/ui/GlassBadge";
import { GlassButton } from "@/components/ui/GlassButton";
import { GlassCard } from "@/components/ui/GlassCard";
import { HashValue, PageHeader, SourceNote } from "@/components/shared/Integrity";
import { SubmissionResult } from "@/components/shared/SubmissionResult";
import { ModelStatusPanel } from "@/components/live/ModelStatusPanel";
import {
  api,
  fileToBase64,
  type BankEntry,
  type BanksResponse,
  type SubmissionResponse,
  type TrainingRoundResponse,
} from "@/lib/api";
import { useModelStatus } from "@/lib/useModelStatus";

type Rounds = TrainingRoundResponse["rounds"];

function bankLabel(id: string): string {
  const m = /^bank_(\d+)$/.exec(id);
  return m && Number(m[1]) < 26 ? `Bank ${String.fromCharCode(65 + Number(m[1]))}` : id;
}

function BankCard({ bank }: { bank: BankEntry }) {
  const u = bank.latest_update;
  const approval = u?.approval_status;
  return (
    <GlassCard className="p-5 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-[15px] font-bold text-[var(--ink-primary)]">{bank.display_name}</h3>
          <p className="text-[11.5px] font-mono text-[var(--ink-muted)]">{bank.bank_id}</p>
        </div>
        {bank.in_current_federation ? (
          <GlassBadge tone="good" size="sm">IN CURRENT RUN</GlassBadge>
        ) : bank.enrolled ? (
          <GlassBadge tone="neutral" size="sm">ENROLLED · NOT IN RUN</GlassBadge>
        ) : (
          <GlassBadge tone="warning" size="sm">NOT ENROLLED</GlassBadge>
        )}
      </div>

      <dl className="space-y-1.5 text-[12px]">
        <div className="flex justify-between gap-2">
          <dt className="text-[var(--ink-muted)]">Identity key</dt>
          <dd className="font-mono text-right">
            {bank.key_id ?? "none"}
            {bank.key_custody && (
              <span className="block text-[10.5px] text-[var(--ink-muted)]">
                {bank.key_custody === "simulated_server_side" ? "simulated: server holds the key" : "external: bank holds the key"}
              </span>
            )}
          </dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-[var(--ink-muted)]">Local training data</dt>
          <dd className="text-right">
            {bank.local_training_rows != null ? `${bank.local_training_rows.toLocaleString()} rows` : "—"}
            {bank.data_origin && <span className="block text-[10.5px] text-[var(--ink-muted)]">{bank.data_origin}</span>}
          </dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-[var(--ink-muted)]">Rounds accepted / rejected</dt>
          <dd className="font-mono">
            {bank.round_history ? `${bank.round_history.accepted} / ${bank.round_history.rejected}` : "—"}
          </dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-[var(--ink-muted)]">Latest model update</dt>
          <dd className="font-mono text-right">
            {u ? `v${u.version} · round ${u.round}` : "none"}
            {approval && (
              <span
                className={`block text-[10.5px] ${
                  approval === "accepted"
                    ? "text-[var(--status-good)]"
                    : approval === "quarantined" || approval === "rejected"
                      ? "text-[var(--status-critical)]"
                      : "text-[var(--status-warning)]"
                }`}
              >
                {approval}
              </span>
            )}
          </dd>
        </div>
        {u && (
          <div className="flex justify-between items-center gap-2 min-w-0">
            <dt className="text-[var(--ink-muted)] shrink-0">Update hash</dt>
            <dd className="min-w-0"><HashValue hash={u.content_hash} label="update hash" /></dd>
          </div>
        )}
        {u?.metadata?.aggregation_weight != null && (
          <div className="flex justify-between gap-2">
            <dt className="text-[var(--ink-muted)]">Aggregation weight · reputation</dt>
            <dd className="font-mono">
              {Number(u.metadata.aggregation_weight).toFixed(4)}
              {u.metadata.reputation != null ? ` · ${Number(u.metadata.reputation).toFixed(3)}` : ""}
            </dd>
          </div>
        )}
        <div className="flex justify-between gap-2">
          <dt className="text-[var(--ink-muted)]">Model versions · rejected attempts</dt>
          <dd className="font-mono">
            {bank.model_update_versions} · {bank.rejected_submissions}
          </dd>
        </div>
        {bank.latest_dataset && (
          <div className="flex justify-between gap-2">
            <dt className="text-[var(--ink-muted)]">Registered dataset</dt>
            <dd className="font-mono text-right">
              v{bank.latest_dataset.version} · {String(bank.latest_dataset.metadata?.rows ?? "?")} rows
            </dd>
          </div>
        )}
      </dl>
    </GlassCard>
  );
}

function SubmitPanel({ banks, onDone }: { banks: BankEntry[]; onDone: () => void }) {
  const signable = banks.filter((b) => b.enrolled && b.key_custody === "simulated_server_side");
  const [bankId, setBankId] = useState<string>("");
  const [kind, setKind] = useState<"retrain" | "model_update" | "dataset">("retrain");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SubmissionResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const selected = bankId || signable[0]?.bank_id || "";

  const submit = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    const res =
      kind === "retrain"
        ? await api.demoSignerModelUpdate(selected, "legitimate_retrain")
        : file
          ? await api.demoSignerUpload(selected, kind, await fileToBase64(file))
          : null;
    setBusy(false);
    if (res === null) {
      setError("Choose a file first.");
    } else if (res.ok) {
      setResult(res.data);
      onDone();
    } else {
      setError(res.message);
    }
  };

  return (
    <GlassCard variant="elevated" className="p-5 sm:p-6 space-y-4" id="submit">
      <div className="flex items-center gap-2">
        <FileArrowUp size={20} className="text-[var(--accent-cyan)]" />
        <h2 className="text-base font-bold text-[var(--ink-primary)]">Submit a bank contribution</h2>
        <GlassBadge tone="warning" size="sm">SIMULATED BANK SIGNER</GlassBadge>
      </div>
      <p className="text-[12.5px] text-[var(--ink-secondary)] leading-relaxed">
        The three artifact types are handled differently and are never interchangeable. A <strong>model update</strong>{" "}
        must match the global model&apos;s architecture exactly. A <strong>dataset</strong> is schema-checked, hashed and
        recorded for provenance only. It is <em>not</em> trained on, and its contents never leave the server. The{" "}
        <strong>global model</strong> can only be published by the coordinator. A browser holds no keys, so the server signs as
        the selected simulated bank, then runs the same validation as an externally signed submission.
      </p>

      {signable.length === 0 ? (
        <p className="text-[13px] text-[var(--ink-muted)]">
          No simulated banks are enrolled yet. They are enrolled when the first training run completes.
        </p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-[13px]">
          <label className="space-y-1">
            <span className="text-[12px] text-[var(--ink-muted)]">Bank</span>
            <select
              value={selected}
              onChange={(e) => setBankId(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-[var(--glass-subtle)] border border-[var(--glass-border)] text-[var(--ink-primary)]"
            >
              {signable.map((b) => (
                <option key={b.bank_id} value={b.bank_id}>
                  {b.display_name} ({b.bank_id})
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-[12px] text-[var(--ink-muted)]">Contribution</span>
            <select
              value={kind}
              onChange={(e) => {
                setKind(e.target.value as typeof kind);
                setFile(null);
              }}
              className="w-full px-3 py-2 rounded-lg bg-[var(--glass-subtle)] border border-[var(--glass-border)] text-[var(--ink-primary)]"
            >
              <option value="retrain">Model update: retrain locally on the bank&apos;s data</option>
              <option value="model_update">Model update: upload a .npz file</option>
              <option value="dataset">Training data: register a .csv file</option>
            </select>
          </label>
          <div className="space-y-1">
            <span className="text-[12px] text-[var(--ink-muted)] block">File</span>
            {kind === "retrain" ? (
              <p className="text-[12px] text-[var(--ink-secondary)] py-2">
                No file: the server runs real local training from this round&apos;s base model.
              </p>
            ) : (
              <input
                type="file"
                accept={kind === "dataset" ? ".csv,text/csv" : ".npz"}
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                aria-label={kind === "dataset" ? "Dataset CSV file" : "Model update npz file"}
                className="w-full text-[12px] text-[var(--ink-secondary)] file:mr-2 file:px-3 file:py-1.5 file:rounded-lg file:border-0 file:bg-[var(--glass-elevated)] file:text-[var(--ink-primary)]"
              />
            )}
          </div>
        </div>
      )}

      {kind === "dataset" && (
        <SourceNote>
          Required CSV columns: amount, hour, merchant_cat, device_type, account_age_days, txn_count_24h, amount_zscore,
          is_foreign, is_fraud (0/1). At least 10 rows, no missing values, at most 10 MB.
        </SourceNote>
      )}

      <div className="flex items-center gap-3">
        <GlassButton
          variant="primary"
          size="md"
          loading={busy}
          disabled={!selected || (kind !== "retrain" && !file)}
          onClick={submit}
        >
          Sign &amp; submit
        </GlassButton>
        {error && <span className="text-[12.5px] text-[var(--status-critical)]">{error}</span>}
      </div>

      {result && <SubmissionResult result={result} />}

      <SourceNote>
        Recorded updates are validated and versioned but are <strong>not</strong> merged into the model that serves
        predictions. Aggregation happens only inside a training run (Retrain above).
      </SourceNote>
    </GlassCard>
  );
}

export function BanksClient() {
  const status = useModelStatus();
  const [banks, setBanks] = useState<BanksResponse | null>(null);
  const [banksError, setBanksError] = useState<string | null>(null);
  const [rounds, setRounds] = useState<Rounds>([]);
  const jobId = status.data?.job_id ?? null;
  const [refreshKey, setRefreshKey] = useState(0);
  const reload = useCallback(() => setRefreshKey((k) => k + 1), []);

  useEffect(() => {
    let alive = true;
    (async () => {
      const [b, r] = await Promise.all([api.banks(), jobId ? api.trainingRound(jobId) : Promise.resolve(null)]);
      if (!alive) return;
      if (b.ok) {
        setBanks(b.data);
        setBanksError(null);
      } else {
        setBanksError(b.message);
      }
      setRounds(r && r.ok ? r.data.rounds : []);
    })();
    return () => {
      alive = false;
    };
  }, [jobId, refreshKey]);


  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 space-y-8">
      <PageHeader
        icon={<Buildings size={22} />}
        title="Banks & Federated Training"
        description={
          <>
            Each bank trains on its own data, and only model parameters reach the coordinator. The coordinator validates
            every update, applies the defense, and averages the accepted ones into the global model.
            <span className="block mt-1 text-[13px] text-[var(--ink-muted)]">
              This is a <strong>simulation</strong>: the banks run inside one process on separate synthetic partitions. Each
              one really trains its own local model; they are not separate institutions or machines.
            </span>
          </>
        }
      >
        <GlassBadge tone="cyan">GET /banks</GlassBadge>
        <GlassBadge tone="cyan">GET /training-round</GlassBadge>
      </PageHeader>

      <ModelStatusPanel status={status} />

      {/* Bank registry */}
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <Database size={20} className="text-[var(--accent-cyan)]" />
            <h2 className="text-lg font-bold text-[var(--ink-primary)]">Bank registry</h2>
          </div>
          {banks?.federation && (
            <span className="text-[12px] font-mono text-[var(--ink-muted)]">
              run {banks.federation.job_id} · {banks.federation.model.model_family}
            </span>
          )}
        </div>
        {banksError ? (
          <GlassCard className="p-5 text-[13px] text-[var(--status-critical)]">Could not load banks: {banksError}</GlassCard>
        ) : !banks ? (
          <GlassCard className="p-5 text-[13px] text-[var(--ink-muted)]">Loading banks…</GlassCard>
        ) : banks.banks.length === 0 ? (
          <GlassCard className="p-5 text-[13px] text-[var(--ink-muted)]">
            No banks yet. Banks appear when a training run completes, or when one is enrolled from the command line.
          </GlassCard>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {banks.banks.map((b) => (
              <BankCard key={b.bank_id} bank={b} />
            ))}
          </div>
        )}
      </section>

      {/* Round-by-round decisions */}
      {rounds.length > 0 && (
        <GlassCard className="overflow-hidden">
          <div className="p-5 border-b border-[var(--glass-border)] flex items-center gap-2">
            <Gear size={18} className="text-[var(--accent-cyan)]" />
            <h2 className="text-base font-bold text-[var(--ink-primary)]">Round-by-round coordinator decisions</h2>
            <span className="text-[12px] text-[var(--ink-muted)]">from GET /training-round/{jobId}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead className="text-[11px] uppercase tracking-wider text-[var(--ink-muted)] bg-[var(--glass-subtle)]">
                <tr>
                  <th className="text-left px-4 py-2.5">Round</th>
                  <th className="text-left px-4 py-2.5">PR-AUC</th>
                  <th className="text-left px-4 py-2.5">Accepted</th>
                  <th className="text-left px-4 py-2.5">Rejected</th>
                  <th className="text-left px-4 py-2.5">Weights</th>
                  <th className="text-left px-4 py-2.5">Reputation</th>
                  <th className="text-left px-4 py-2.5">Agent flagged</th>
                  <th className="text-left px-4 py-2.5">Ledger</th>
                </tr>
              </thead>
              <tbody>
                {rounds.map((r) => (
                  <tr key={r.round} className="border-t border-[var(--glass-border)] font-mono">
                    <td className="px-4 py-2">{r.round}</td>
                    <td className="px-4 py-2">{r.eval.pr_auc.toFixed(4)}</td>
                    <td className="px-4 py-2 font-sans">{r.decision?.accepted.map(bankLabel).join(", ") || "none"}</td>
                    <td className="px-4 py-2 font-sans">{r.decision?.rejected.map(bankLabel).join(", ") || "none"}</td>
                    <td className="px-4 py-2 whitespace-nowrap">
                      {r.decision ? Object.entries(r.decision.weights).map(([k, w]) => `${bankLabel(k).slice(-1)} ${w.toFixed(3)}`).join("  ") : "—"}
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap">
                      {r.decision && Object.keys(r.decision.reputation).length
                        ? Object.entries(r.decision.reputation).map(([k, v]) => `${bankLabel(k).slice(-1)} ${v.toFixed(3)}`).join("  ")
                        : "n/a for this defense"}
                    </td>
                    <td className="px-4 py-2 font-sans">{r.agent?.flagged.length ? r.agent.flagged.map(bankLabel).join(", ") : "none"}</td>
                    <td className="px-4 py-2">{r.ledger ? `#${r.ledger.index}` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </GlassCard>
      )}

      {banks && <SubmitPanel banks={banks.banks} onDone={reload} />}
    </div>
  );
}
