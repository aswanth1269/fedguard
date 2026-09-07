/**
 * Client for the live FedGuard API.
 *
 * The rest of the dashboard reads `public/data/runs.json`, a static export of
 * `results/runs.jsonl`. That is the right shape for the results pages: they
 * show finished experiments, the numbers never change, and a build-time import
 * means the marketing surface renders with no server running at all.
 *
 * The audit surface is different. A ledger's whole value is that you can check
 * it right now, against the chain, yourself. A verification result baked into a
 * build is a claim about the past, not a check - so this one talks to the
 * running API.
 *
 * Shapes here mirror `docs/api.yaml`, which is generated from the FastAPI app
 * by `scripts/export_openapi.py`. If a field below stops matching, the contract
 * is the source of truth, not this file.
 */

/** Overridable so the dashboard can point at a coordinator that is not local. */
export const API_BASE =
  process.env.NEXT_PUBLIC_FEDGUARD_API?.replace(/\/$/, "") ?? "http://127.0.0.1:8000";

/** GET /verify - the actual tamper-evidence check over the whole chain. */
export type VerifyResult = {
  ok: boolean;
  entries_checked: number;
  failed_at_index: number | null;
  failed_round: number | null;
  reason: string | null;
};

/** One anchored round, as `LedgerEntry.to_dict()` serialises it. */
export type LedgerEntry = {
  index: number;
  config_hash: string;
  round_num: number;
  model_hash: string;
  decision: {
    round?: number;
    accepted?: string[];
    rejected?: string[];
    weights?: Record<string, number>;
    reputation?: Record<string, number>;
    diagnostics?: Record<string, number>;
  } | null;
  verdict: { round?: number; flagged?: string[]; boundary_version?: string } | null;
  eval: { pr_auc?: number; asr?: number | null; threshold?: number | null } | null;
  timestamp: number;
  prev_hash: string;
  entry_hash: string;
};

export type LedgerResponse = { count: number; entries: LedgerEntry[] };

/**
 * A failed call is a state the page renders, not an exception it throws.
 *
 * The overwhelmingly likely reason this fails is that nobody has started the
 * API - which is normal, not broken, and the page should say so plainly rather
 * than showing a spinner forever or a stack trace. Distinguishing "offline"
 * from "the server answered with an error" matters because the two have
 * completely different fixes.
 */
export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; kind: "offline" | "error"; message: string };

async function get<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      // The point of this surface is a check performed now. A cached
      // verification result is worse than none: it would report a chain state
      // that may no longer hold, with no indication it is stale.
      cache: "no-store",
      ...init,
    });
    if (!res.ok) {
      return {
        ok: false,
        kind: "error",
        message: `${res.status} ${res.statusText} from ${path}`,
      };
    }
    return { ok: true, data: (await res.json()) as T };
  } catch {
    // fetch only rejects on a transport failure: DNS, refused connection,
    // CORS. An HTTP error status is handled above.
    return {
      ok: false,
      kind: "offline",
      message: `No coordinator answering at ${API_BASE}`,
    };
  }
}

export const api = {
  health: () => get<{ status: string }>("/health"),
  verify: () => get<VerifyResult>("/verify"),
  ledger: (configHash?: string) =>
    get<LedgerResponse>(configHash ? `/ledger?config_hash=${encodeURIComponent(configHash)}` : "/ledger"),
};

/** Hashes are 64 hex characters. Nobody reads one; they compare the ends. */
export function shortHash(hash: string, head = 8, tail = 6): string {
  if (hash.length <= head + tail + 1) return hash;
  return `${hash.slice(0, head)}…${hash.slice(-tail)}`;
}

export function formatTimestamp(seconds: number): string {
  return new Date(seconds * 1000).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "medium",
  });
}
