"use client";

import { useEffect, useState } from "react";
import { Cube } from "@phosphor-icons/react";

import { api, type ApiResult, type LedgerResponse, type VerifyResult } from "@/lib/api";

/**
 * Audit-chain KPI, read live.
 *
 * The other three tiles come from an exported run record, which is right for
 * them: those numbers are fixed once the experiment finishes. Chain integrity
 * is not that kind of number. It is only worth showing if it was checked just
 * now, so this one calls the API and says plainly when it could not.
 */
export function LedgerTile() {
  const [verify, setVerify] = useState<ApiResult<VerifyResult> | null>(null);
  const [ledger, setLedger] = useState<ApiResult<LedgerResponse> | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [v, l] = await Promise.all([api.verify(), api.ledger()]);
      if (cancelled) return;
      setVerify(v);
      setLedger(l);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const offline = verify?.ok === false;
  const ok = verify?.ok === true && verify.data.ok;
  const count = ledger?.ok === true ? ledger.data.count : null;

  const state = verify === null
    ? { word: "checking", color: "var(--ink-muted)" }
    : offline
      ? { word: "coordinator offline", color: "var(--ink-muted)" }
      : ok
        ? { word: "chain verified", color: "var(--status-good)" }
        : { word: "chain broken", color: "var(--status-critical)" };

  return (
    <div className="rounded-card glass-quiet p-5">
      <div className="flex items-start justify-between gap-3">
        <span className="text-[13px] text-ink-2">Audit chain</span>
        <Cube size={18} weight="bold" aria-hidden style={{ color: state.color }} />
      </div>
      <div className="mt-3 flex flex-wrap items-baseline gap-2">
        <span className="tnum text-[32px] font-medium leading-none tracking-tight text-ink">
          {count === null ? "--" : count.toLocaleString("en-US")}
        </span>
        <span className="text-[12px] text-ink-muted">anchored rounds</span>
      </div>
      <p className="mt-2 font-mono text-[12px]" style={{ color: state.color }}>
        {state.word}
      </p>
      <p className="mt-1 text-[12px] leading-relaxed text-ink-muted">
        {offline
          ? "Start the API to check integrity from here."
          : "Model, reputation and decision hashes, chained per round."}
      </p>
    </div>
  );
}
