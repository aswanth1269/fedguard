// Unit tests for lib/playground.ts with mocked /predict and /explain.
// Run: npm test  (Node's built-in runner; Node >= 22.18 loads .ts directly)
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  PLAYGROUND_THRESHOLD,
  checkExplanation,
  classify,
  createInferenceRunner,
  formatProbability,
  sameInputs,
  summarize,
  toModelFeatures,
} from "../lib/playground.ts";

const INPUTS = {
  amount: 42,
  hour: 14,
  merchant_cat: 2,
  device_type: 0,
  account_age_days: 480,
  txn_count_24h: 2,
  amount_zscore: -0.22,
  ip_risk: 0.05,
  distance_km: 3.2,
};

/** Mock backend: score is a deterministic function of the request; explain
 * returns contributions that add up, like the real /explain. */
function mockBackend({ probabilityFor, failPredict = false, failExplain = false, jobId = "job1" } = {}) {
  const calls = { predict: [], explain: [] };
  const prob = probabilityFor ?? ((f) => Math.min(0.99, f.amount / 3000 + f.txn_count_24h / 50));
  return {
    calls,
    deps: {
      predict: async (f) => {
        calls.predict.push(f);
        if (failPredict) return { ok: false, message: "boom", statusCode: 500 };
        return { ok: true, data: { probability: prob(f), threshold: 0.8051, job_id: jobId, model: { model_name: "mlp", global_model_version: 1 } } };
      },
      explain: async (f) => {
        calls.explain.push(f);
        if (failExplain) return { ok: false, message: "explanation unavailable: forced" };
        const p = prob(f);
        const base = 0.2;
        const keys = Object.keys(f);
        const share = (p - base) / keys.length;
        return {
          ok: true,
          data: {
            probability: p,
            job_id: jobId,
            base_value: base,
            output_scale: "probability",
            background_size: 100,
            contributions: keys.map((k) => ({ feature: k, value: f[k], contribution: share })),
          },
        };
      },
    },
  };
}

test("changing the amount sends the new amount", async () => {
  const b = mockBackend();
  const run = createInferenceRunner(b.deps);
  await run({ ...INPUTS, amount: 2500 });
  assert.equal(b.calls.predict[0].amount, 2500);
  assert.equal(b.calls.explain[0].amount, 2500);
});

test("hour, account age, velocity and distance send their current values; IP risk is not sent", async () => {
  const b = mockBackend();
  const run = createInferenceRunner(b.deps);
  await run({ ...INPUTS, hour: 3, account_age_days: 9, txn_count_24h: 31, distance_km: 4200, ip_risk: 0.9 });
  const sent = b.calls.predict[0];
  assert.equal(sent.hour, 3);
  assert.equal(sent.account_age_days, 9);
  assert.equal(sent.txn_count_24h, 31);
  assert.equal(sent.is_foreign, 1); // 4200 km >= 500 km
  assert.ok(!("ip_risk" in sent) && !("distance_km" in sent));
  assert.deepEqual(Object.keys(sent).sort(), [
    "account_age_days", "amount", "amount_zscore", "device_type", "hour", "is_foreign", "merchant_cat", "txn_count_24h",
  ]);
  assert.equal(toModelFeatures({ ...INPUTS, distance_km: 499.9 }).is_foreign, 0);
});

test("repeated inference returns the new score, not the previous one", async () => {
  const run = createInferenceRunner(mockBackend().deps);
  const a = await run({ ...INPUTS, amount: 300 });
  const b = await run({ ...INPUTS, amount: 2700 });
  assert.notEqual(a.prediction.probability, b.prediction.probability);
  assert.equal(b.prediction.inputs.amount, 2700);
});

test("an older request that finishes late is discarded", async () => {
  let release;
  const slow = new Promise((r) => (release = r));
  const b = mockBackend();
  const deps = {
    ...b.deps,
    predict: async (f) => (f.amount === 100 ? (await slow, b.deps.predict(f)) : b.deps.predict(f)),
  };
  const run = createInferenceRunner(deps);
  const first = run({ ...INPUTS, amount: 100 });
  const second = await run({ ...INPUTS, amount: 2000 });
  release();
  assert.equal(await first, null);
  assert.equal(second.prediction.inputs.amount, 2000);
});

test("probability is formatted as a percentage", () => {
  assert.equal(formatProbability(0.9939), "99.4%");
  assert.equal(formatProbability(0.05), "5.0%");
  assert.equal(formatProbability(0), "0.0%");
});

test("the playground threshold is exactly 50%", () => {
  assert.equal(PLAYGROUND_THRESHOLD, 0.5);
  assert.equal(PLAYGROUND_THRESHOLD.toFixed(4), "0.5000");
  assert.equal(classify(0.5), "Likely Fraud");
  assert.equal(classify(0.4999), "Not Likely Fraud");
  assert.equal(classify(0.81), "Likely Fraud");
  assert.equal(classify(0.6), "Likely Fraud"); // below the model's 0.8051, still Likely Fraud here
});

test("the decision is computed from the returned probability, ignoring the backend threshold", async () => {
  const run = createInferenceRunner(mockBackend({ probabilityFor: () => 0.6 }).deps);
  const out = await run(INPUTS);
  assert.equal(out.prediction.decision, "Likely Fraud");
});

test("a failed inference returns an error and no score", async () => {
  const run = createInferenceRunner(mockBackend({ failPredict: true }).deps);
  const out = await run(INPUTS);
  assert.equal(out.kind, "error");
  assert.ok(!("prediction" in out));
});

test("an invalid probability from the backend is an error, not a score", async () => {
  const run = createInferenceRunner(mockBackend({ probabilityFor: () => 3.2 }).deps);
  assert.equal((await run(INPUTS)).kind, "error");
});

test("a failed explanation keeps the valid prediction", async () => {
  const run = createInferenceRunner(mockBackend({ failExplain: true }).deps);
  const out = await run(INPUTS);
  assert.equal(out.kind, "ok");
  assert.equal(out.explanation.kind, "unavailable");
  assert.ok(Number.isFinite(out.prediction.probability));
});

test("the explanation is for the same input and score as the prediction", async () => {
  const b = mockBackend();
  const run = createInferenceRunner(b.deps);
  const out = await run({ ...INPUTS, amount: 1234 });
  assert.deepEqual(b.calls.predict[0], b.calls.explain[0]);
  assert.equal(out.explanation.kind, "ready");
  const amount = out.explanation.contributions.find((c) => c.feature === "amount");
  assert.equal(amount.value, 1234);
});

test("explanations for a different model, score or input are rejected", () => {
  const prediction = { inputs: INPUTS, features: toModelFeatures(INPUTS), probability: 0.4, decision: "Not Likely Fraud", jobId: "job1", model: "mlp v1" };
  const good = {
    probability: 0.4, job_id: "job1", base_value: 0.2, output_scale: "probability", background_size: 100,
    contributions: Object.entries(prediction.features).map(([k, v]) => ({ feature: k, value: v, contribution: 0.2 / 8 })),
  };
  assert.equal(checkExplanation(prediction, good).kind, "ready");
  assert.equal(checkExplanation(prediction, { ...good, job_id: "job2" }).kind, "unavailable");
  assert.equal(checkExplanation(prediction, { ...good, probability: 0.41 }).kind, "unavailable");
  assert.equal(checkExplanation(prediction, { ...good, output_scale: "log_odds" }).kind, "unavailable");
  const wrongValue = { ...good, contributions: good.contributions.map((c) => (c.feature === "hour" ? { ...c, value: 3 } : c)) };
  assert.equal(checkExplanation(prediction, wrongValue).kind, "unavailable");
  const notAdditive = { ...good, contributions: good.contributions.map((c) => ({ ...c, contribution: 0.1 })) };
  assert.equal(checkExplanation(prediction, notAdditive).kind, "unavailable");
});

test("the summary is built from the actual contributions", () => {
  const prediction = { probability: 0.9, features: {}, inputs: INPUTS };
  const exp = {
    kind: "ready", baseValue: 0.2, backgroundSize: 100,
    contributions: [
      { feature: "txn_count_24h", value: 31, contribution: 0.55 },
      { feature: "hour", value: 3, contribution: 0.2 },
      { feature: "amount", value: 900, contribution: -0.05 },
    ],
  };
  const s = summarize(prediction, exp);
  assert.match(s, /90\.0%/);
  assert.match(s, /baseline of 20\.0%/);
  assert.match(s, /24h velocity count \(\+55\.0 percentage points\)/);
  assert.match(s, /transaction amount \(−5\.0 percentage points\)/);
});

test("stale detection compares every control", () => {
  assert.ok(sameInputs(INPUTS, { ...INPUTS }));
  for (const k of Object.keys(INPUTS)) assert.ok(!sameInputs(INPUTS, { ...INPUTS, [k]: INPUTS[k] + 1 }), k);
});
