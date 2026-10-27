/**
 * Inference-playground logic, kept free of React so it can be unit-tested
 * (web/tests/playground.test.mjs). The component only renders what this
 * returns.
 *
 * Source of truth: one InferenceOutcome per request. The score comes from
 * POST /predict; the explanation from POST /explain is attached only when it
 * is for the same job and the same probability, i.e. the same model and input.
 */

/** Playground-only decision rule. The model's own operating threshold still
 * drives the transaction feed and is not shown in the playground. */
export const PLAYGROUND_THRESHOLD = 0.5;

/** Distance from home at or beyond which a transaction counts as cross-border. */
export const FOREIGN_DISTANCE_KM = 500;

export type PlaygroundInputs = {
  amount: number;
  hour: number;
  merchant_cat: number;
  device_type: number;
  account_age_days: number;
  txn_count_24h: number;
  amount_zscore: number;
  ip_risk: number;
  distance_km: number;
};

export type ModelFeatures = {
  amount: number;
  hour: number;
  merchant_cat: number;
  device_type: number;
  account_age_days: number;
  txn_count_24h: number;
  amount_zscore: number;
  is_foreign: number;
};

/** The eight model inputs, from the panel's current values. ip_risk is not a
 * model input and is never sent. */
export function toModelFeatures(i: PlaygroundInputs): ModelFeatures {
  return {
    amount: i.amount,
    hour: i.hour,
    merchant_cat: i.merchant_cat,
    device_type: i.device_type,
    account_age_days: i.account_age_days,
    txn_count_24h: i.txn_count_24h,
    amount_zscore: i.amount_zscore,
    is_foreign: i.distance_km >= FOREIGN_DISTANCE_KM ? 1 : 0,
  };
}

export type Decision = "Likely Fraud" | "Not Likely Fraud";

export function classify(probability: number): Decision {
  return probability >= PLAYGROUND_THRESHOLD ? "Likely Fraud" : "Not Likely Fraud";
}

export function formatProbability(probability: number): string {
  return `${(probability * 100).toFixed(1)}%`;
}

export function sameInputs(a: PlaygroundInputs, b: PlaygroundInputs): boolean {
  return (Object.keys(a) as (keyof PlaygroundInputs)[]).every((k) => a[k] === b[k]);
}

// -- feature roles in the explanation -----------------------------------------
export type FeatureRole = "input" | "derived" | "fixed";

export const FEATURE_INFO: Record<keyof ModelFeatures, { label: string; role: FeatureRole; note: string }> = {
  amount: { label: "Transaction amount", role: "input", note: "your input" },
  hour: { label: "Transaction hour", role: "input", note: "your input" },
  account_age_days: { label: "Account age", role: "input", note: "your input" },
  txn_count_24h: { label: "24h velocity count", role: "input", note: "your input" },
  is_foreign: { label: "Cross-border", role: "derived", note: `derived from Distance (≥ ${FOREIGN_DISTANCE_KM} km)` },
  merchant_cat: { label: "Merchant category", role: "fixed", note: "preset value, no control here" },
  device_type: { label: "Device type", role: "fixed", note: "preset value, no control here" },
  amount_zscore: { label: "Amount z-score", role: "fixed", note: "preset value, no control here" },
};

/** Visible controls the model does not receive at all. */
export const UNUSED_CONTROLS = ["IP Risk Index"];

// -- one request ---------------------------------------------------------------
type Result<T> = { ok: true; data: T } | { ok: false; message: string; statusCode?: number };

export type PredictData = {
  probability: number;
  threshold: number;
  job_id: string;
  model?: { model_name?: string; global_model_version?: number | null } | null;
};

export type Contribution = { feature: string; value: number; contribution: number };

export type ExplainData = {
  probability: number;
  job_id: string;
  base_value: number;
  output_scale: string;
  background_size: number;
  contributions: Contribution[];
};

export type Prediction = {
  inputs: PlaygroundInputs;
  features: ModelFeatures;
  probability: number;
  decision: Decision;
  jobId: string;
  model: string;
};

export type Explanation =
  | { kind: "ready"; baseValue: number; backgroundSize: number; contributions: Contribution[] }
  | { kind: "unavailable"; reason: string };

export type InferenceOutcome =
  | { kind: "ok"; prediction: Prediction; explanation: Explanation }
  | { kind: "error"; message: string };

const ADDITIVE_TOLERANCE = 1e-4;

/** Use an explanation only if it explains THIS prediction, in probability
 * units, and its contributions add up: base + sum = probability. */
export function checkExplanation(prediction: Prediction, exp: ExplainData): Explanation {
  if (exp.job_id !== prediction.jobId) return { kind: "unavailable", reason: "the model changed between requests" };
  if (Math.abs(exp.probability - prediction.probability) > 1e-9)
    return { kind: "unavailable", reason: "explanation is for a different score" };
  if (exp.output_scale !== "probability")
    return { kind: "unavailable", reason: `unsupported output scale ${exp.output_scale}` };
  const names = exp.contributions.map((c) => c.feature).sort();
  const expected = Object.keys(prediction.features).sort();
  if (names.join() !== expected.join()) return { kind: "unavailable", reason: "features do not match the model input" };
  for (const c of exp.contributions) {
    if (c.value !== prediction.features[c.feature as keyof ModelFeatures])
      return { kind: "unavailable", reason: "explanation is for a different input" };
  }
  const total = exp.base_value + exp.contributions.reduce((s, c) => s + c.contribution, 0);
  if (Math.abs(total - prediction.probability) > ADDITIVE_TOLERANCE)
    return { kind: "unavailable", reason: "contributions do not add up to the score" };
  return {
    kind: "ready",
    baseValue: exp.base_value,
    backgroundSize: exp.background_size,
    contributions: exp.contributions,
  };
}

export type InferenceDeps = {
  predict: (f: ModelFeatures) => Promise<Result<PredictData>>;
  explain: (f: ModelFeatures) => Promise<Result<ExplainData>>;
};

/** Returns a function that runs one inference. A request that has been
 * superseded by a newer one resolves to null and must not be displayed. */
export function createInferenceRunner(deps: InferenceDeps) {
  let latest = 0;
  return async (inputs: PlaygroundInputs): Promise<InferenceOutcome | null> => {
    const id = ++latest;
    const snapshot = { ...inputs };
    const features = toModelFeatures(snapshot);

    const res = await deps.predict(features);
    if (id !== latest) return null;
    if (!res.ok) {
      return {
        kind: "error",
        message:
          res.statusCode === 409
            ? "No trained global model is loaded. Initialize the model in the status panel above."
            : res.message,
      };
    }
    const p = res.data.probability;
    if (typeof p !== "number" || !Number.isFinite(p) || p < 0 || p > 1) {
      return { kind: "error", message: "The backend returned an invalid probability." };
    }
    const version = res.data.model?.global_model_version;
    const prediction: Prediction = {
      inputs: snapshot,
      features,
      probability: p,
      decision: classify(p),
      jobId: res.data.job_id,
      model: `${res.data.model?.model_name ?? "global model"}${version != null ? ` v${version}` : ""}`,
    };

    let explanation: Explanation;
    try {
      const exp = await deps.explain(features);
      explanation = exp.ok ? checkExplanation(prediction, exp.data) : { kind: "unavailable", reason: exp.message };
    } catch (err) {
      explanation = { kind: "unavailable", reason: err instanceof Error ? err.message : "request failed" };
    }
    if (id !== latest) return null;
    return { kind: "ok", prediction, explanation };
  };
}

/** Plain-English summary built only from the calculated contributions. */
export function summarize(prediction: Prediction, exp: Extract<Explanation, { kind: "ready" }>): string {
  const pp = (c: number) => `${Math.abs(c * 100).toFixed(1)} percentage points`;
  const up = exp.contributions.filter((c) => c.contribution > 0).sort((a, b) => b.contribution - a.contribution);
  const down = exp.contributions.filter((c) => c.contribution < 0).sort((a, b) => a.contribution - b.contribution);
  const name = (f: string) => (FEATURE_INFO[f as keyof ModelFeatures]?.label ?? f).toLowerCase();
  const parts = [
    `The model scored this transaction ${formatProbability(prediction.probability)}, compared with a baseline of ${formatProbability(exp.baseValue)}.`,
  ];
  if (up.length) parts.push(`The largest increase came from ${name(up[0].feature)} (+${pp(up[0].contribution)}).`);
  if (down.length) parts.push(`The largest decrease came from ${name(down[0].feature)} (−${pp(down[0].contribution)}).`);
  return parts.join(" ");
}
