/**
 * Typed API Client for the live FedGuard FastAPI Backend.
 *
 * Exposes full typed access to the coordinator, model status,
 * federated rounds, participants, agent verdicts, human approvals,
 * live prediction scoring, and cryptographic blockchain ledger verification.
 */

export const API_BASE =
  process.env.NEXT_PUBLIC_FEDGUARD_API?.replace(/\/$/, "") ?? "http://127.0.0.1:8000";

/** Cryptographic verification result over the full blockchain ledger */
export type VerifyResult = {
  ok: boolean;
  entries_checked: number;
  failed_at_index: number | null;
  failed_round: number | null;
  reason: string | null;
};

/** Anchored round entry in the blockchain ledger */
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
  verdict: {
    round?: number;
    flagged?: string[];
    boundary_version?: string;
    narrative?: string;
  } | null;
  eval: {
    pr_auc?: number;
    roc_auc?: number;
    asr?: number | null;
    threshold?: number | null;
    recall_at_fpr?: Record<string, number>;
  } | null;
  timestamp: number;
  prev_hash: string;
  entry_hash: string;
};

export type LedgerResponse = {
  count: number;
  entries: LedgerEntry[];
};

export type JobStatusResponse = {
  job_id: string;
  status: "queued" | "running" | "complete" | "failed";
  final?: {
    pr_auc: number;
    roc_auc: number;
    recall_at_fpr: Record<string, number>;
    asr: number | null;
    threshold: number | null;
    n_samples: number;
    n_positive: number;
  };
  error?: string;
};

export type TrainingRoundResponse = {
  job_id: string;
  status: string;
  rounds: Array<{
    round: number;
    eval: {
      pr_auc: number;
      roc_auc: number;
      recall_at_fpr: Record<string, number>;
      asr: number | null;
      threshold: number | null;
    };
    decision: {
      round: number;
      accepted: string[];
      rejected: string[];
      weights: Record<string, number>;
      reputation: Record<string, number>;
      diagnostics: Record<string, number>;
    };
    agent?: {
      round: number;
      flagged: string[];
      boundary_version: string;
      narrative: string;
    };
    human_override?: {
      approved: boolean;
      note?: string;
      at: number;
    };
    validation_failures?: string[];
    round_state?: string;
    ledger?: { index: number; entry_hash: string } | null;
  }>;
};

export type ParticipantsResponse = {
  job_id: string;
  status: string;
  participants: Array<{
    client_id: string;
    malicious: boolean;
    rounds_seen: number;
    accepted: number;
    rejected: number;
    agent_flagged: number;
  }>;
};

export type AgentStatusResponse = {
  job_id: string;
  status: string;
  rounds_reviewed: number;
  rounds_flagged: number;
  latest_verdict?: {
    round: number;
    flagged: string[];
    boundary_version: string;
    narrative: string;
  } | null;
};

export type AgentSummaryResponse = {
  job_id: string;
  status: string;
  rounds_reviewed: number;
  rounds_flagged: number;
  summary: string;
};

export type PredictRequest = {
  features: Record<string, number>;
};

/** Which model produced a score or a status - always from the backend. */
export type ModelProvenance = {
  job_id: string;
  model_name: string;
  model_family: string;
  config_name: string;
  config_hash: string;
  rounds: number;
  defense: string;
  data_source: string;
  global_model_version: number | null;
  global_model_hash: string | null;
};

export type PredictResponse = {
  probability: number;
  label: number;
  threshold: number;
  job_id: string;
  model?: ModelProvenance | null;
};

export type ExplainResponse = {
  probability: number;
  label: number;
  threshold: number;
  job_id: string;
  method: string;
  output_scale: string;
  base_value: number;
  background_size: number;
  contributions: { feature: string; value: number; contribution: number }[];
};

export type ApproveModelRequest = {
  job_id: string;
  round_num: number;
  note?: string;
};

export type ApproveModelResponse = {
  job_id: string;
  round: number;
  human_override: {
    approved: boolean;
    note?: string;
    at: number;
  };
};

export type TrainAccepted = {
  job_id: string;
  status: string;
};

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; kind: "offline" | "error"; message: string; statusCode?: number };

async function request<T>(path: string, options?: RequestInit): Promise<ApiResult<T>> {
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        ...options?.headers,
      },
      ...options,
    });

    if (!res.ok) {
      let detail = `${res.status} ${res.statusText}`;
      try {
        const errorJson = await res.json();
        if (errorJson?.detail) detail = errorJson.detail;
      } catch {
        // fallback
      }
      return {
        ok: false,
        kind: "error",
        statusCode: res.status,
        message: detail,
      };
    }

    const data = (await res.json()) as T;
    return { ok: true, data };
  } catch (err: unknown) {
    const isOffline =
      err instanceof TypeError &&
      (err.message.includes("fetch") || err.message.includes("Failed to fetch") || err.message.includes("NetworkError"));
    return {
      ok: false,
      kind: isOffline ? "offline" : "error",
      message: isOffline
        ? `Cannot connect to FedGuard API at ${API_BASE}`
        : err instanceof Error
        ? err.message
        : "Unknown connection error",
    };
  }
}

export type VerifyHashRequest = {
  payload: Record<string, unknown>;
  baseline_hash?: string;
};

export type VerifyHashResponse = {
  canonical_json: string;
  digest: string;
  algorithm: string;
  matches: boolean | null;
  status: string;
};

export type ActiveJob = {
  job_id: string;
  status: "queued" | "running";
  config_name: string;
  model_name: string;
  rounds_done: number;
  rounds_total: number;
  submitted_at: number;
};

export type CurrentModelStatusResponse = {
  job_id: string | null;
  status: string;
  threshold?: number;
  input_cols: string[];
  final?: {
    pr_auc?: number;
    roc_auc?: number;
    recall_at_fpr?: Record<string, number>;
    asr?: number | null;
    threshold?: number | null;
    n_samples?: number;
    n_positive?: number;
  } | null;
  model?: ModelProvenance | null;
  participants?: { accepted: string[]; rejected: string[]; agent_flagged: string[] } | null;
  completed_at?: number | null;
  active_job?: ActiveJob | null;
  last_failure?: { job_id: string; error: string | null; config_name: string } | null;
  warnings?: string[];
};

export type TransactionEvent = {
  seq: number;
  transaction_id: string;
  bank_id: string | null;
  bank_display: string | null;
  event_time: string;
  received_at: string;
  source: "api" | "synthetic_demo";
  features: Record<string, number>;
  probability: number;
  label: number;
  threshold: number;
  classification: "alert" | "lower_risk";
  synthetic_label: number | null;
  explanation: null;
  model: ModelProvenance;
};

export type TransactionsResponse = { events: TransactionEvent[]; latest_seq: number };

export type CheckResult = {
  name: string;
  status: "pass" | "fail" | "skipped" | "not_applicable";
  detail: string;
};

export type Outcome =
  | "AUTHORIZED_NEW_VERSION"
  | "INTEGRITY_VERIFIED"
  | "INTEGRITY_FAILURE"
  | "UNAUTHORIZED_SUBMISSION"
  | "SIGNATURE_INVALID"
  | "VALIDATION_FAILED"
  | "SUSPICIOUS_UPDATE"
  | "PENDING_REVIEW";

export type ArtifactType = "model_update" | "global_model" | "dataset";

export type ArtifactRecord = {
  seq: number;
  kind: "version" | "rejected_submission" | "verification";
  artifact_id: string;
  artifact_type: ArtifactType;
  owner: string;
  owner_display: string;
  version: number | null;
  round: number | null;
  content_hash: string;
  hash_scheme?: string;
  timestamp: number;
  schema?: { tensors?: { name: string; shape: number[]; dtype: string }[]; columns?: string[] };
  metadata?: Record<string, unknown>;
  submitted_by?: string | null;
  channel?: string;
  signature?: {
    scheme: string;
    key_id: string | null;
    status: "verified" | "invalid" | "unknown_key";
    custody: string | null;
  };
  decision?: { outcome: Outcome; approval_status: string; checks: CheckResult[]; reasons: string[] };
  approval_status?: string;
  defense_evidence?: { source: string; verdict: string; detail: string; metrics: Record<string, number> };
  previous_version_ref?: { seq: number; version: number; content_hash: string } | null;
  ledger_ref?: {
    ledger_index: number;
    entry_hash: string;
    legacy_model_hash: string;
    legacy_hash_matches: boolean;
  } | null;
  chain_anchor?: null;
  verified_seq?: number;
  verified_version?: number;
  trusted_hash?: string;
  claimed_version?: number;
  candidate_origin?: string;
  prev_entry_hash: string;
  entry_hash: string;
  storage: "local_artifact_registry";
  on_chain: false;
};

export type SubmissionResponse = {
  outcome: Outcome;
  approval_status: string;
  registers_version: boolean;
  checks: CheckResult[];
  reasons: string[];
  record: ArtifactRecord;
  channel: string;
};

export type VerifyArtifactResponse = {
  outcome: Outcome;
  trusted_hash: string;
  candidate_hash: string;
  candidate_origin: string;
  version: number;
  artifact_id: string;
  checks: CheckResult[];
  reasons: string[];
  verification_seq: number;
};

export type BankEntry = {
  bank_id: string;
  display_name: string;
  enrolled: boolean;
  key_id: string | null;
  key_custody: "simulated_server_side" | "external" | null;
  in_current_federation: boolean;
  local_training_rows: number | null;
  data_origin: string | null;
  round_history: { accepted: number; rejected: number } | null;
  model_update_versions: number;
  latest_update: ArtifactRecord | null;
  latest_dataset: ArtifactRecord | null;
  rejected_submissions: number;
};

export type BanksResponse = {
  banks: BankEntry[];
  federation: {
    job_id: string;
    simulated: boolean;
    note: string;
    model: ModelProvenance;
    n_clients: number;
  } | null;
};

export type IntegrityStatus = {
  blockchain: {
    backend: string;
    configured: boolean;
    status: "not_configured" | "unreachable" | "connected";
    detail: string;
    contract_address?: string;
  };
  round_ledger: { ok: boolean | null; entries_checked?: number; reason?: string | null; detail?: string };
  artifact_registry: { ok: boolean; entries_checked: number; failed_at_seq: number | null; reason: string | null };
  signatures: {
    scheme: string;
    available: boolean;
    trusted_keys: number;
    simulated_custody?: number;
    external_custody?: number;
    detail?: string;
  };
  demo_signer_enabled: boolean;
  trust_model: string[];
};

export type DemoScenario =
  | "legitimate_retrain"
  | "malicious_update"
  | "impersonation"
  | "invalid_signature"
  | "wrong_architecture"
  | "bank_publishes_global_model";

export const api = {
  health: () => request<{ status: string }>("/health"),

  verify: () => request<VerifyResult>("/verify"),

  ledger: (configHash?: string) =>
    request<LedgerResponse>(configHash ? `/ledger?config_hash=${encodeURIComponent(configHash)}` : "/ledger"),

  ledgerForJob: (jobId: string) => request<{ job_id: string; count: number; entries: LedgerEntry[] }>(`/ledger/${jobId}`),

  auditJob: (jobId: string) =>
    request<{ job_id: string; status: string; entries: LedgerEntry[]; summary: string }>(`/audit/${jobId}`),

  predict: (features: Record<string, number>) =>
    request<PredictResponse>("/predict", {
      method: "POST",
      body: JSON.stringify({ features }),
    }),

  explain: (features: Record<string, number>) =>
    request<ExplainResponse>("/explain", {
      method: "POST",
      body: JSON.stringify({ features }),
    }),

  approveModel: (req: ApproveModelRequest) =>
    request<ApproveModelResponse>("/approve-model", {
      method: "POST",
      body: JSON.stringify(req),
    }),

  train: (config: Record<string, unknown>) =>
    request<TrainAccepted>("/train", {
      method: "POST",
      body: JSON.stringify(config),
    }),

  demoWarmup: (force = false) =>
    request<TrainAccepted>(`/demo/warmup${force ? "?force=true" : ""}`, {
      method: "POST",
    }),

  transactions: (after: number) => request<TransactionsResponse>(`/transactions?after=${after}`),

  demoTransactions: (count = 1) =>
    request<{ events: TransactionEvent[] }>("/demo/transactions", {
      method: "POST",
      body: JSON.stringify({ count }),
    }),

  banks: () => request<BanksResponse>("/banks"),

  integrityStatus: () => request<IntegrityStatus>("/integrity/status"),

  artifacts: (filter: { artifact_type?: ArtifactType; owner?: string; kind?: string } = {}) => {
    const q = new URLSearchParams(
      Object.entries(filter).filter(([, v]) => v !== undefined) as [string, string][]
    ).toString();
    return request<{ count: number; records: ArtifactRecord[] }>(`/artifacts${q ? `?${q}` : ""}`);
  },

  verifyArtifact: (
    seq: number,
    body: { source: "stored" | "modified_copy" | "upload"; tensor_index?: number; delta?: number; upload_b64?: string }
  ) =>
    request<VerifyArtifactResponse>(`/artifacts/${seq}/verify`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  demoSignerModelUpdate: (member_id: string, scenario: DemoScenario) =>
    request<SubmissionResponse>("/demo/bank-signer/model-update", {
      method: "POST",
      body: JSON.stringify({ member_id, scenario }),
    }),

  demoSignerUpload: (
    member_id: string,
    artifact_type: "dataset" | "model_update",
    payload_b64: string,
    claims_version_seq?: number
  ) =>
    request<SubmissionResponse>("/demo/bank-signer/upload", {
      method: "POST",
      body: JSON.stringify({ member_id, artifact_type, payload_b64, claims_version_seq }),
    }),

  currentModelStatus: () => request<CurrentModelStatusResponse>("/model-status"),

  verifyTransactionHash: (payload: Record<string, unknown>, baselineHash?: string) =>
    request<VerifyHashResponse>("/verify-transaction-hash", {
      method: "POST",
      body: JSON.stringify({ payload, baseline_hash: baselineHash }),
    }),

  modelStatus: (jobId: string) => request<JobStatusResponse>(`/model-status/${jobId}`),

  trainingRound: (jobId: string) => request<TrainingRoundResponse>(`/training-round/${jobId}`),

  participants: (jobId: string) => request<ParticipantsResponse>(`/participants/${jobId}`),

  agentStatus: (jobId: string) => request<AgentStatusResponse>(`/agent-status/${jobId}`),

  agentSummary: (jobId: string) => request<AgentSummaryResponse>(`/agent-summary/${jobId}`),
};

/** URL of a model artifact's stored file (datasets are not downloadable). */
export function artifactDownloadUrl(seq: number): string {
  return `${API_BASE}/artifacts/${seq}/download`;
}

/** Base64 of a browser File, for upload routes that take JSON bodies. */
export async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/** Display-only truncation. Comparisons always use the full digest. */
export function shortHash(hash: string, head = 8, tail = 6): string {
  if (!hash || hash.length <= head + tail + 1) return hash || "—";
  return `${hash.slice(0, head)}…${hash.slice(-tail)}`;
}

export function formatTimestamp(seconds: number): string {
  if (!seconds) return "—";
  return new Date(seconds * 1000).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "medium",
  });
}
