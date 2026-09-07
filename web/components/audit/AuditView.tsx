"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ArrowClockwise,
  CheckCircle,
  Link as LinkIcon,
  Plugs,
  ShieldWarning,
} from "@phosphor-icons/react";

import {
  API_BASE,
  formatTimestamp,
  shortHash,
  api,
  type ApiResult,
  type LedgerEntry,
  type LedgerResponse,
  type VerifyResult,
} from "@/lib/api";

/**
 * Live view of the audit chain.
 *
 * Deliberately not a build-time export like the rest of the dashboard. A
 * ledger's value is that it can be checked *now*; a verification result baked
 * into a build is a claim about the past.
 *
 * The page never asserts integrity on its own. Every judgement shown here comes
 * from GET /verify, which runs `HashChain.verify()` server-side - the same
 * discipline the monitor follows over runs.jsonl. A dashboard that recomputed
 * "looks fine to me" in TypeScript would be a second, weaker source of truth
 * for exactly the property the ledger exists to establish.
 */
export function AuditView() {
  const [verify, setVerify] = useState<ApiResult<VerifyResult> | null>(null);
  const [ledger, setLedger] = useState<ApiResult<LedgerResponse> | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [v, l] = await Promise.all([api.verify(), api.ledger()]);
    setVerify(v);
    setLedger(l);
    setLoading(false);
  }, []);

  // The initial fetch is written out rather than calling load(), because
  // load() sets loading synchronously and a synchronous setState in an effect
  // body triggers a cascading render. Here the first setState happens after an
  // await, and `loading` already starts true. The cancelled flag stops a
  // response that lands after unmount from setting state.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [v, l] = await Promise.all([api.verify(), api.ledger()]);
      if (cancelled) return;
      setVerify(v);
      setLedger(l);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const offline = verify?.ok === false && verify.kind === "offline";

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end gap-4">
        {/* Capped at 100%: a bare min-w-[18rem] is wider than the viewport on
            the narrowest screens and pushes the whole page into horizontal
            scroll. The min() keeps the intended behaviour, which is to send the
            re-check button to its own row before the heading starts squeezing. */}
        <div className="min-w-[min(18rem,100%)] flex-1">
          <h1 className="text-2xl font-medium tracking-tight text-ink">Audit chain</h1>
          <p className="mt-2 max-w-[68ch] text-[15px] leading-relaxed text-ink-2">
            Every completed round is anchored, whether or not the agent flagged it. A flagged
            round is content that belongs on the chain, not a reason to skip writing it. Each entry
            embeds the previous entry&rsquo;s hash, so altering any past round breaks every hash
            after it.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="flex items-center gap-2 rounded-control border border-hairline px-3.5 py-2 text-[13px] text-ink-2 transition-colors hover:text-ink disabled:opacity-50"
        >
          <ArrowClockwise size={15} weight="bold" aria-hidden />
          {loading ? "Checking…" : "Re-check"}
        </button>
      </header>

      {offline ? (
        <OfflineNotice />
      ) : (
        <>
          <VerifyPanel result={verify} loading={loading} />
          <LedgerTable result={ledger} loading={loading} />
        </>
      )}
    </div>
  );
}

/** Not an error state. Nobody has started the coordinator, which is normal. */
function OfflineNotice() {
  return (
    <section className="rounded-card glass p-6">
      <div className="flex items-start gap-3">
        <Plugs size={20} weight="bold" className="mt-0.5 shrink-0 text-ink-muted" aria-hidden />
        <div>
          <h2 className="text-[15px] font-medium text-ink">No coordinator answering</h2>
          <p className="mt-1.5 max-w-[65ch] text-[13px] leading-relaxed text-ink-2">
            This page reads the chain live rather than from a build-time export, so it needs the
            API running at <code className="font-mono text-[12px] text-ink">{API_BASE}</code>.
          </p>
          <pre className="mt-4 overflow-x-auto rounded-control border border-hairline bg-surface-2 px-4 py-3 font-mono text-[12px] leading-relaxed text-ink-2">
            {`uvicorn fedguard.api.main:app --port 8000`}
          </pre>
          <p className="mt-3 max-w-[65ch] text-[13px] leading-relaxed text-ink-2">
            Point elsewhere with{" "}
            <code className="font-mono text-[12px] text-ink">NEXT_PUBLIC_FEDGUARD_API</code>.
          </p>
        </div>
      </div>
    </section>
  );
}

function VerifyPanel({
  result,
  loading,
}: {
  result: ApiResult<VerifyResult> | null;
  loading: boolean;
}) {
  if (loading || !result) return <SkeletonPanel />;

  if (!result.ok) {
    return (
      <StatusPanel
        tone="warning"
        title="Could not check the chain"
        detail={result.message}
      />
    );
  }

  const v = result.data;
  if (v.ok) {
    return (
      <StatusPanel
        tone="good"
        title={`Chain intact: ${v.entries_checked} ${
          v.entries_checked === 1 ? "entry" : "entries"
        } verified`}
        detail="Every entry's stored hash matches its own content, and every entry links to the one before it."
      />
    );
  }

  return (
    <StatusPanel
      tone="critical"
      title={`Chain broken at entry ${v.failed_at_index} (round ${v.failed_round})`}
      detail={v.reason ?? "No reason reported."}
      note={`${v.entries_checked} ${
        v.entries_checked === 1 ? "entry" : "entries"
      } verified before the failure. Everything after it is unverifiable, not merely suspect.`}
    />
  );
}

/**
 * Status is carried by an icon and a word, never by colour alone. The same
 * rule the charts follow for their series.
 */
function StatusPanel({
  tone,
  title,
  detail,
  note,
}: {
  tone: "good" | "warning" | "critical";
  title: string;
  detail: string;
  note?: string;
}) {
  const styles = {
    good: { color: "var(--status-good)", Icon: CheckCircle, word: "Verified" },
    warning: { color: "var(--status-warning)", Icon: ShieldWarning, word: "Unknown" },
    critical: { color: "var(--status-critical)", Icon: ShieldWarning, word: "Failed" },
  }[tone];
  const { Icon } = styles;

  return (
    <section className="rounded-card glass p-6">
      <div className="flex items-start gap-3">
        <Icon
          size={20}
          weight="fill"
          className="mt-0.5 shrink-0"
          style={{ color: styles.color }}
          aria-hidden
        />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className="rounded-full px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide"
              style={{ color: styles.color, border: `1px solid ${styles.color}` }}
            >
              {styles.word}
            </span>
            <h2 className="text-[15px] font-medium text-ink">{title}</h2>
          </div>
          <p className="mt-2 max-w-[70ch] text-[13px] leading-relaxed text-ink-2">{detail}</p>
          {note && (
            <p className="mt-2 max-w-[70ch] text-[13px] leading-relaxed text-ink-muted">{note}</p>
          )}
        </div>
      </div>
    </section>
  );
}

function LedgerTable({
  result,
  loading,
}: {
  result: ApiResult<LedgerResponse> | null;
  loading: boolean;
}) {
  if (loading || !result) return <SkeletonPanel rows={4} />;

  if (!result.ok) {
    return <StatusPanel tone="warning" title="Could not read the ledger" detail={result.message} />;
  }

  const entries = result.data.entries;

  if (entries.length === 0) {
    return (
      <section className="rounded-card glass p-6">
        <h2 className="text-[15px] font-medium text-ink">Nothing anchored yet</h2>
        <p className="mt-1.5 max-w-[65ch] text-[13px] leading-relaxed text-ink-2">
          The chain is empty. Run an experiment and every round will be written here as it
          completes.
        </p>
        <pre className="mt-4 overflow-x-auto rounded-control border border-hairline bg-surface-2 px-4 py-3 font-mono text-[12px] text-ink-2">
          {`fedguard run --config configs/smoke.yaml`}
        </pre>
      </section>
    );
  }

  return (
    <section className="rounded-card glass">
      <header className="border-b border-hairline px-5 py-4">
        <h2 className="text-[15px] font-medium text-ink">
          {entries.length} anchored {entries.length === 1 ? "round" : "rounds"}
        </h2>
        <p className="mt-1 max-w-[70ch] text-[13px] text-ink-2">
          In chain order. <span className="font-mono text-[12px]">prev</span> is the preceding
          entry&rsquo;s hash. That link is what makes tampering detectable.
        </p>
      </header>

      {/* Wide table scrolls inside its own container so the page body never
          scrolls horizontally. */}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[56rem] border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-hairline text-left text-[12px] text-ink-muted">
              <th scope="col" className="px-5 py-2.5 font-medium">#</th>
              <th scope="col" className="px-3 py-2.5 font-medium">Round</th>
              <th scope="col" className="px-3 py-2.5 font-medium">Run</th>
              <th scope="col" className="px-3 py-2.5 font-medium">Accepted</th>
              <th scope="col" className="px-3 py-2.5 font-medium">Rejected</th>
              <th scope="col" className="px-3 py-2.5 font-medium">Flagged</th>
              <th scope="col" className="px-3 py-2.5 font-medium">Entry hash</th>
              <th scope="col" className="px-5 py-2.5 font-medium">Anchored</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <LedgerRow key={`${e.config_hash}-${e.index}`} entry={e} />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function LedgerRow({ entry }: { entry: LedgerEntry }) {
  const accepted = entry.decision?.accepted ?? [];
  const rejected = entry.decision?.rejected ?? [];
  const flagged = entry.verdict?.flagged ?? [];

  return (
    <tr className="border-b border-hairline last:border-0 align-top">
      <td className="px-5 py-3 font-mono text-[12px] text-ink-muted">{entry.index}</td>
      <td className="px-3 py-3 text-ink">{entry.round_num}</td>
      <td className="px-3 py-3 font-mono text-[12px] text-ink-2">{entry.config_hash}</td>
      <td className="px-3 py-3 text-ink-2">{accepted.length}</td>
      <td className="px-3 py-3">
        {rejected.length === 0 ? (
          <span className="text-ink-muted">none</span>
        ) : (
          <span className="text-ink" title={rejected.join(", ")}>
            {rejected.length}
          </span>
        )}
      </td>
      <td className="px-3 py-3">
        {flagged.length === 0 ? (
          <span className="text-ink-muted">none</span>
        ) : (
          <span className="text-ink" title={flagged.join(", ")}>
            {flagged.join(", ")}
          </span>
        )}
      </td>
      <td className="px-3 py-3">
        <div className="font-mono text-[12px] text-ink" title={entry.entry_hash}>
          {shortHash(entry.entry_hash)}
        </div>
        <div
          className="mt-1 flex items-center gap-1 font-mono text-[11px] text-ink-muted"
          title={entry.prev_hash}
        >
          <LinkIcon size={11} weight="bold" aria-hidden />
          prev {shortHash(entry.prev_hash, 6, 4)}
        </div>
      </td>
      <td className="px-5 py-3 whitespace-nowrap text-[12px] text-ink-2">
        {formatTimestamp(entry.timestamp)}
      </td>
    </tr>
  );
}

function SkeletonPanel({ rows = 1 }: { rows?: number }) {
  return (
    <section className="rounded-card glass p-6" aria-busy>
      <div className="space-y-3">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="h-4 w-full max-w-[38rem] rounded bg-surface-2" />
        ))}
      </div>
      <span className="sr-only">Loading</span>
    </section>
  );
}
