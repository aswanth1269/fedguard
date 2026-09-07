import { readFileSync } from "node:fs";
import { join } from "node:path";

import { ArrowUpRight, ShieldCheck, Warning } from "@phosphor-icons/react/dist/ssr";

import { ConsoleHeader } from "@/components/ConsoleHeader";
import { LedgerTile } from "@/components/command/LedgerTile";
import { TransactionStream, type StreamFile } from "@/components/command/TransactionStream";
import type { RunRecord, RunsFile } from "@/lib/runs";
import runsData from "@/public/data/runs.json";

export const metadata = {
  title: "Fraud Command | FedGuard",
  description:
    "Operator view of the federated consortium: headline detection quality, attack success against the clean control, coordinator state and the audit chain.",
};

const { runs } = runsData as unknown as RunsFile;

/* The attacked run is what an operator would be watching; the clean run is the
   control every number on this page is read against. Both are looked up by id
   rather than by position, so adding runs cannot silently repoint the page. */
const LIVE_ID = "e_ieee_backdoor_fedavg";
const CONTROL_ID = "d_ieee_clean";

function loadStream(): StreamFile | null {
  /* Read rather than import: the stream is produced by a separate, expensive
     script and a page that refuses to build because nobody has run it yet
     would be a bad trade. Same pattern the dashboard uses for SHAP. */
  try {
    const raw = readFileSync(join(process.cwd(), "public/data/stream.json"), "utf8");
    return JSON.parse(raw) as StreamFile;
  } catch {
    return null;
  }
}

function pct(x: number, digits = 2): string {
  return `${(x * 100).toFixed(digits)}%`;
}

function signed(x: number, digits = 4): string {
  return `${x >= 0 ? "+" : ""}${x.toFixed(digits)}`;
}

export default function CommandPage() {
  const live = runs.find((r) => r.id === LIVE_ID);
  const control = runs.find((r) => r.id === CONTROL_ID);
  const stream = loadStream();

  if (!live) {
    return (
      <>
        <ConsoleHeader active="command" />
        <main className="mx-auto w-full max-w-[65ch] flex-1 px-5 py-24">
          <h1 className="text-2xl font-medium text-ink">No run to command</h1>
          <p className="mt-3 text-[15px] leading-relaxed text-ink-2">
            This page is a view of <code className="font-mono text-[13px]">results/runs.jsonl</code>
            . Run an experiment and export it:
          </p>
          <pre className="mt-4 overflow-x-auto rounded-control border border-hairline bg-surface-2 px-4 py-3 font-mono text-[12px] text-ink-2">
            {`fedguard run --config configs/e_ieee_backdoor_fedavg.yaml\npython scripts/export_dashboard_data.py`}
          </pre>
        </main>
      </>
    );
  }

  const finalRound = live.series[live.series.length - 1];
  const clients = live.clients;
  const flaggedRounds = live.series.filter((s) => s.rejected.length > 0).length;

  const prAuc = live.final?.pr_auc ?? 0;
  const controlPrAuc = control?.final?.pr_auc ?? null;
  const asr = live.final?.asr ?? null;
  const controlAsr = control?.final?.asr ?? null;

  return (
    <>
      <ConsoleHeader
        active="command"
        nodes={{ total: clients.length, synchronized: finalRound.accepted.length }}
      />

      <main className="mx-auto w-full max-w-[1400px] flex-1 space-y-6 px-5 py-8 lg:px-8">
        {/* ---- hero band ------------------------------------------------ */}
        <section className="rounded-card glass p-6 lg:p-8">
          <div className="flex flex-wrap items-start gap-6">
            <div className="min-w-[min(22rem,100%)] flex-1">
              <span className="inline-flex items-center gap-2 rounded-full border border-accent/30 bg-accent/10 px-2.5 py-1 font-mono text-[11px] tracking-wide text-accent">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-accent" aria-hidden />
                CONSORTIUM FEDERATED ENGINE
              </span>
              <h1 className="mt-4 text-3xl font-medium tracking-tight text-ink lg:text-4xl">
                Decentralized financial fraud intelligence
              </h1>
              <p className="mt-3 max-w-[68ch] text-[15px] leading-relaxed text-ink-2">
                {clients.length} simulated banks, partitioned from IEEE-CIS by card network,
                training a shared fraud model under {live.defense.name} aggregation. One of them is
                poisoning its own fraud typology. The audit chain records every round.
              </p>
              <div className="mt-5 flex flex-wrap gap-3">
                <a
                  href="/dashboard#explainability"
                  className="flex items-center gap-1.5 rounded-control bg-accent px-4 py-2.5 text-[13px] font-medium text-accent-ink transition-colors hover:bg-accent-hover active:translate-y-px"
                >
                  Inspect a prediction
                  <ArrowUpRight size={14} weight="bold" aria-hidden />
                </a>
                <a
                  href="/dashboard"
                  className="rounded-control border border-hairline px-4 py-2.5 text-[13px] text-ink-2 transition-colors hover:text-ink active:translate-y-px"
                >
                  Round-by-round monitor
                </a>
              </div>
            </div>
          </div>
        </section>

        {/* ---- KPI row --------------------------------------------------- */}
        <section id="metrics" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Tile
            label="Global PR-AUC"
            value={prAuc.toFixed(4)}
            delta={
              controlPrAuc === null
                ? undefined
                : { text: signed(prAuc - controlPrAuc), good: true }
            }
            foot={`${live.defense.name} aggregation, round ${live.rounds}`}
            note="Not accuracy: at 3.5% fraud, predicting 'never fraud' scores 96.5%."
            Icon={ShieldCheck}
          />
          <Tile
            label="Attack success rate"
            value={asr === null ? "n/a" : pct(asr)}
            delta={
              asr === null || controlAsr === null
                ? undefined
                : {
                    text: `${signed((asr - controlAsr) * 100, 1)} pts vs control`,
                    good: false,
                  }
            }
            foot={
              controlAsr === null
                ? "no clean control exported"
                : `clean control ${pct(controlAsr)}`
            }
            note="Triggered fraud the model lets through. The metric the attack moves."
            Icon={Warning}
            tone="critical"
          />
          <Tile
            label="Evaluated exposure"
            value={
              stream
                ? `$${(stream.totalExposure / 1e6).toFixed(1)}M`
                : `${(live.final?.n_samples ?? 0).toLocaleString("en-US")}`
            }
            foot={
              stream
                ? `${stream.nTest.toLocaleString("en-US")} transactions scored`
                : "transactions in the held-out split"
            }
            note={`${(live.final?.n_positive ?? 0).toLocaleString("en-US")} of them fraudulent`}
          />
          <LedgerTile />
        </section>

        {/* ---- stream + nodes -------------------------------------------- */}
        <section className="grid gap-4 xl:grid-cols-[1.6fr_1fr]">
          <TransactionStream stream={stream} />
          <NodePanel run={live} />
        </section>

        {/* ---- sentinel --------------------------------------------------- */}
        <section id="sentinel" className="rounded-card glass p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-[min(20rem,100%)] flex-1">
              <h2 className="text-[15px] font-medium text-ink">Agentic Sentinel</h2>
              <p className="mt-1.5 max-w-[70ch] text-[13px] leading-relaxed text-ink-2">
                The coordinator agent rules on every round. Its accept/reject boundary is a
                versioned Python function over reputation and cross-round rejection frequency, and
                that function, not any language model, is what gets hashed into the ledger. An LLM
                only writes the prose attached to a verdict.
              </p>
            </div>
            <span className="rounded-full border border-hairline px-2.5 py-1 font-mono text-[11px] text-ink-2">
              boundary v1.0.0
            </span>
          </div>
          <dl className="mt-5 grid gap-4 sm:grid-cols-3">
            <Stat label="Rounds reviewed" value={String(live.series.length)} />
            <Stat
              label="Rounds with an exclusion"
              value={String(flaggedRounds)}
              tone={flaggedRounds > 0 ? "warning" : undefined}
            />
            <Stat
              label="Malicious client"
              value={live.attack.malicious_clients.join(", ") || "none"}
              tone={live.attack.malicious_clients.length ? "critical" : undefined}
            />
          </dl>
        </section>
      </main>
    </>
  );
}

/* --------------------------------------------------------------------------
   pieces
   -------------------------------------------------------------------------- */

function Tile({
  label,
  value,
  delta,
  foot,
  note,
  Icon,
  tone,
}: {
  label: string;
  value: string;
  delta?: { text: string; good: boolean };
  foot: string;
  note?: string;
  Icon?: typeof ShieldCheck;
  tone?: "critical";
}) {
  return (
    <div className="rounded-card glass-quiet p-5">
      <div className="flex items-start justify-between gap-3">
        <span className="text-[13px] text-ink-2">{label}</span>
        {Icon && (
          <Icon
            size={18}
            weight="bold"
            aria-hidden
            style={{ color: tone === "critical" ? "var(--status-serious)" : "var(--accent)" }}
          />
        )}
      </div>
      <div className="mt-3 flex flex-wrap items-baseline gap-2">
        <span className="tnum text-[32px] font-medium leading-none tracking-tight text-ink">
          {value}
        </span>
        {delta && (
          <span
            className="tnum font-mono text-[12px]"
            style={{ color: delta.good ? "var(--status-good)" : "var(--status-serious)" }}
          >
            {delta.text}
          </span>
        )}
      </div>
      <p className="mt-2 text-[12px] text-ink-muted">{foot}</p>
      {note && <p className="mt-1 text-[12px] leading-relaxed text-ink-muted">{note}</p>}
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "warning" | "critical";
}) {
  const color =
    tone === "critical"
      ? "var(--status-critical)"
      : tone === "warning"
        ? "var(--status-warning)"
        : "var(--ink)";
  return (
    <div>
      <dt className="text-[12px] text-ink-muted">{label}</dt>
      <dd className="tnum mt-1 text-[18px] font-medium" style={{ color }}>
        {value}
      </dd>
    </div>
  );
}

/**
 * Per-client roster. Shows aggregation weight, reputation and how often each
 * bank was excluded, all read straight off the decision log.
 *
 * Deliberately no per-client accuracy: the harness records one global eval per
 * round, not a per-bank score, so a number here would have to be invented.
 */
function NodePanel({ run }: { run: RunRecord }) {
  const last = run.series[run.series.length - 1];
  const malicious = new Set(run.attack.malicious_clients);

  const rows = run.clients.map((id) => {
    const rejected = run.series.filter((s) => s.rejected.includes(id)).length;
    return {
      id,
      weight: last.weights[id] ?? 0,
      reputation: last.reputation?.[id],
      rejected,
      malicious: malicious.has(id),
    };
  });

  return (
    <div className="min-w-0 rounded-card glass-quiet">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-hairline px-5 py-4">
        <h2 className="text-[15px] font-medium text-ink">Federated bank nodes</h2>
        <span className="font-mono text-[11px] tracking-wide text-ink-2">
          {last.accepted.length}/{run.clients.length} AGGREGATED
        </span>
      </header>
      <ul className="divide-y divide-hairline">
        {rows.map((r) => (
          <li key={r.id} className="px-5 py-3.5">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <span className="flex items-center gap-2 text-[14px] text-ink">
                <span
                  aria-hidden
                  className="inline-block h-1.5 w-1.5 rounded-full"
                  style={{
                    background: last.accepted.includes(r.id)
                      ? "var(--status-good)"
                      : "var(--status-critical)",
                  }}
                />
                {r.id}
                {r.malicious && (
                  <span
                    className="rounded-full px-1.5 py-px font-mono text-[10px]"
                    style={{
                      color: "var(--status-critical)",
                      border: "1px solid var(--status-critical)",
                    }}
                  >
                    POISONING
                  </span>
                )}
              </span>
              <span className="tnum font-mono text-[13px] text-ink">
                {(r.weight * 100).toFixed(1)}%
              </span>
            </div>
            <p className="tnum mt-1 font-mono text-[11px] text-ink-muted">
              aggregation weight
              {r.reputation !== undefined && ` · reputation ${r.reputation.toFixed(3)}`}
              {r.rejected > 0 && ` · excluded ${r.rejected}x`}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
