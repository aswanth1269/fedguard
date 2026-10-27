"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { CaretDown, CaretRight, Pause, Play, Pulse } from "@phosphor-icons/react";
import { GlassBadge } from "@/components/ui/GlassBadge";
import { GlassButton } from "@/components/ui/GlassButton";
import { GlassCard } from "@/components/ui/GlassCard";
import { HashValue, SourceNote } from "@/components/shared/Integrity";
import { api, type TransactionEvent } from "@/lib/api";

const POLL_MS = 2000;
const DEMO_MS = 3000;
const KEEP = 100;

type Conn = "connecting" | "live" | "offline" | "error";

const FEATURE_LABELS: Record<string, string> = {
  amount: "Amount ($)",
  hour: "Hour",
  merchant_cat: "Merchant category",
  device_type: "Device fingerprint",
  account_age_days: "Account age (days)",
  txn_count_24h: "24h velocity",
  amount_zscore: "Amount z-score",
  is_foreign: "Cross-border",
};

export function TransactionFeed({ modelReady }: { modelReady: boolean }) {
  const [events, setEvents] = useState<TransactionEvent[]>([]);
  const [conn, setConn] = useState<Conn>("connecting");
  const [connError, setConnError] = useState<string | null>(null);
  const [demoOn, setDemoOn] = useState(false);
  const [demoError, setDemoError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const cursor = useRef(0);

  // Poll GET /transactions with a seq cursor: each event arrives exactly once.
  useEffect(() => {
    let alive = true;
    const poll = async () => {
      const res = await api.transactions(cursor.current);
      if (!alive) return;
      if (!res.ok) {
        setConn(res.kind === "offline" ? "offline" : "error");
        setConnError(res.message);
        return;
      }
      setConn("live");
      setConnError(null);
      if (res.data.latest_seq < cursor.current) {
        // The server restarted with a fresh feed; re-read it from the start.
        cursor.current = 0;
        setEvents([]);
        return;
      }
      cursor.current = res.data.latest_seq;
      if (res.data.events.length > 0) {
        setEvents((prev) => {
          const seen = new Set(prev.map((e) => e.seq));
          const fresh = res.data.events.filter((e) => !seen.has(e.seq));
          return [...fresh.reverse(), ...prev].slice(0, KEEP);
        });
      }
    };
    poll();
    const id = setInterval(poll, POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  // Demonstration generator: asks the BACKEND to draw and score one row.
  useEffect(() => {
    if (!demoOn || !modelReady) return;
    let alive = true;
    const gen = async () => {
      const res = await api.demoTransactions(1);
      if (!alive) return;
      if (!res.ok) {
        setDemoError(res.message);
        setDemoOn(false);
      } else {
        setDemoError(null);
      }
    };
    gen();
    const id = setInterval(gen, DEMO_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [demoOn, modelReady]);

  const alerts = events.filter((e) => e.classification === "alert").length;

  return (
    <GlassCard variant="elevated" className="overflow-hidden" id="feed">
      <div className="p-5 sm:p-6 border-b border-[var(--glass-border)] space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <Pulse size={20} className="text-[var(--accent-cyan)]" />
              <h2 className="text-base font-bold text-[var(--ink-primary)]">Transaction event feed</h2>
              {conn === "live" ? (
                <GlassBadge tone="good" size="sm" dot>POLLING · {POLL_MS / 1000}s</GlassBadge>
              ) : conn === "connecting" ? (
                <GlassBadge tone="neutral" size="sm">CONNECTING</GlassBadge>
              ) : (
                <GlassBadge tone="critical" size="sm">{conn === "offline" ? "BACKEND OFFLINE" : "FEED ERROR"}</GlassBadge>
              )}
              {demoOn && <GlassBadge tone="warning" size="sm">FEED RUNNING</GlassBadge>}
            </div>
            <p className="text-[12.5px] text-[var(--ink-secondary)]">
              Every row was scored by the backend&apos;s global model when it arrived (POST /transactions or the demo
              generator). This page only displays results; it computes no scores.
            </p>
          </div>
          <GlassButton
            variant={demoOn ? "glass" : "primary"}
            size="sm"
            disabled={!modelReady || conn !== "live"}
            onClick={() => setDemoOn((v) => !v)}
            icon={demoOn ? <Pause size={14} weight="fill" /> : <Play size={14} weight="fill" />}
          >
            {demoOn ? "Stop live transaction feed" : "Start live transaction feed"}
          </GlassButton>
        </div>

        <SourceNote>
          Demonstration feed: generated transactions, not connected to an external banking system.
        </SourceNote>
        {connError && <p className="text-[12px] text-[var(--status-critical)]">{connError}</p>}
        {demoError && <p className="text-[12px] text-[var(--status-critical)]">Demo feed stopped: {demoError}</p>}
        {events.length > 0 && (
          <div className="flex gap-4 text-[12px] font-mono text-[var(--ink-muted)]">
            <span>{events.length} shown</span>
            <span className="text-[var(--status-critical)]">{alerts} fraud alerts</span>
            <span>{events.length - alerts} lower risk</span>
          </div>
        )}
      </div>

      {events.length === 0 ? (
        <div className="p-10 text-center text-[13px] text-[var(--ink-muted)]">
          {!modelReady
            ? "No events yet. Initialize the model first; nothing can be scored without it."
            : conn !== "live"
              ? "Waiting for the backend…"
              : "No events yet. Start the live transaction feed, or POST a transaction to /transactions."}
        </div>
      ) : (
        <div className="overflow-auto max-h-[480px]">
          <table className="w-full text-[12.5px]">
            <thead className="sticky top-0 z-10 backdrop-blur-xl text-[11px] uppercase tracking-wider text-[var(--ink-muted)] bg-[var(--glass-subtle)]">
              <tr>
                <th className="w-8" />
                <th className="text-left px-3 py-2.5 font-semibold">Time</th>
                <th className="text-left px-3 py-2.5 font-semibold">Transaction</th>
                <th className="text-left px-3 py-2.5 font-semibold">Bank</th>
                <th className="text-right px-3 py-2.5 font-semibold">Amount</th>
                <th className="text-left px-3 py-2.5 font-semibold">Risk score</th>
                <th className="text-left px-3 py-2.5 font-semibold">Classification</th>
                <th className="text-left px-3 py-2.5 font-semibold">Model</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => {
                const open = expanded === e.transaction_id;
                const alert = e.classification === "alert";
                return (
                  <Fragment key={e.seq}>
                    <tr
                      className="border-t border-[var(--glass-border)] hover:bg-[var(--glass-subtle)] cursor-pointer"
                      onClick={() => setExpanded(open ? null : e.transaction_id)}
                    >
                      <td className="pl-3 text-[var(--ink-muted)]">
                        {open ? <CaretDown size={13} /> : <CaretRight size={13} />}
                      </td>
                      <td className="px-3 py-2 font-mono text-[var(--ink-secondary)] whitespace-nowrap">
                        {new Date(e.event_time).toLocaleTimeString()}
                      </td>
                      <td className="px-3 py-2 font-mono text-[var(--ink-primary)] whitespace-nowrap">
                        {e.transaction_id}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">{e.bank_display ?? "—"}</td>
                      <td className="px-3 py-2 text-right font-mono">${(e.features.amount ?? 0).toFixed(2)}</td>
                      <td className="px-3 py-2 min-w-[150px]">
                        <div className="flex items-center gap-2">
                          <div className="relative h-1.5 w-20 rounded-full bg-[var(--glass-subtle)]">
                            <div
                              className={`absolute inset-y-0 left-0 rounded-full ${alert ? "bg-[var(--status-critical)]" : "bg-[var(--status-good)]"}`}
                              style={{ width: `${Math.round(e.probability * 100)}%` }}
                            />
                            <div
                              className="absolute -top-1 -bottom-1 w-px bg-[var(--ink-primary)]"
                              style={{ left: `${Math.round(e.threshold * 100)}%` }}
                              title={`threshold ${e.threshold.toFixed(4)}`}
                            />
                          </div>
                          <span className="font-mono">{e.probability.toFixed(4)}</span>
                        </div>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <GlassBadge tone={alert ? "critical" : "good"} size="sm">
                          {alert ? "FRAUD ALERT" : "LOWER RISK"}
                        </GlassBadge>
                      </td>
                      <td className="px-3 py-2 font-mono text-[var(--ink-secondary)] whitespace-nowrap">
                        {e.model.model_name} v{e.model.global_model_version ?? "?"}
                      </td>
                    </tr>
                    {open && (
                      <tr className="bg-[var(--glass-subtle)]">
                        <td />
                        <td colSpan={7} className="px-3 py-3">
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-[12px]">
                              {Object.entries(e.features).map(([k, v]) => (
                                <Fragment key={k}>
                                  <dt className="text-[var(--ink-muted)]">{FEATURE_LABELS[k] ?? k}</dt>
                                  <dd className="font-mono text-[var(--ink-primary)]">{Number.isInteger(v) ? v : v.toFixed(3)}</dd>
                                </Fragment>
                              ))}
                            </dl>
                            <dl className="space-y-1 text-[12px]">
                              <div><dt className="inline text-[var(--ink-muted)]">Decision threshold: </dt><dd className="inline font-mono">{e.threshold.toFixed(4)}</dd></div>
                              <div><dt className="inline text-[var(--ink-muted)]">Model: </dt><dd className="inline">{e.model.model_family}, job {e.model.job_id}, {e.model.rounds} rounds, {e.model.defense}</dd></div>
                              <div className="flex items-center gap-1"><dt className="text-[var(--ink-muted)]">Global model hash:</dt><dd><HashValue hash={e.model.global_model_hash} label="global model hash" /></dd></div>
                              <div><dt className="inline text-[var(--ink-muted)]">Source: </dt><dd className="inline font-mono">{e.source === "synthetic_demo" ? "demonstration feed" : e.source}</dd></div>
                              {e.synthetic_label != null && (
                                <div><dt className="inline text-[var(--ink-muted)]">Generator label: </dt><dd className="inline">{e.synthetic_label === 1 ? "fraud" : "legitimate"} (ground truth of the generated row; the model did not see it)</dd></div>
                              )}
                              <div className="text-[var(--ink-muted)]">Per-feature explanation is not available for this model in the serving path.</div>
                            </dl>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="px-5 py-3 border-t border-[var(--glass-border)] text-[11.5px] text-[var(--ink-muted)]">
        A high score means the model predicts elevated risk at its operating threshold. It is not proof of fraud.
      </div>
    </GlassCard>
  );
}
