import Link from "next/link";
import {
  ArrowRight,
  ChartLineDown,
  Fingerprint,
  GitBranch,
  Scales,
  SealCheck,
  Stack,
  Target,
} from "@phosphor-icons/react/dist/ssr";

import { SiteHeader } from "@/components/SiteHeader";
import { Reveal } from "@/components/landing/Reveal";
import { PrAucComparison, ReputationTrace } from "@/components/landing/RunCharts";
import { fmt, fmtInt, type RunRecord, type RunsFile } from "@/lib/runs";
import runsData from "@/public/data/runs.json";

const { runs } = runsData as unknown as RunsFile;

function pick(id: string): RunRecord | undefined {
  return runs.find((r) => r.id === id);
}

export default function Home() {
  /* The real-data acts. The synthetic a/b/c runs these used to point at are no
     longer exported: data/synthetic.py exists so CI can exercise the pipeline
     without a 700 MB download, and its own docstring says never to report a
     number from it. That applies to a landing page as much as to a paper. */
  const clean = pick("d_ieee_clean");
  const attacked = pick("e_ieee_backdoor_fedavg");
  const defended = pick("f_ieee_backdoor_reputation");

  if (!clean || !attacked || !defended) {
    return (
      <>
        <SiteHeader active="home" />
        <main className="mx-auto max-w-[65ch] px-5 py-24">
          <h1 className="text-2xl font-medium">No run records found</h1>
          <p className="mt-3 text-ink-2">
            This page renders real experiment output. Run the three configs, then export them:
          </p>
          <pre className="mt-4 overflow-x-auto rounded-card glass p-4 font-mono text-[12px] text-ink-2">
            {"fedguard run --config configs/a_fedavg_clean.yaml\npython scripts/export_dashboard_data.py"}
          </pre>
        </main>
      </>
    );
  }

  const prAucDelta = Math.abs((clean.final?.pr_auc ?? 0) - (attacked.final?.pr_auc ?? 0));

  return (
    <>
      <SiteHeader active="home" />
      <main className="flex-1">
        <Hero clean={clean} attacked={attacked} prAucDelta={prAucDelta} />
        <StatBand clean={clean} attacked={attacked} prAucDelta={prAucDelta} />
        <ThreatModel clean={clean} attacked={attacked} />
        <WhyStatelessMisses />
        <Defenses />
        <Reputation defended={defended} />
        <Results clean={clean} attacked={attacked} defended={defended} />
        <SiteFooter />
      </main>
    </>
  );
}

/* ---------------------------------------------------------------- hero ---- */

function Hero({
  clean,
  attacked,
  prAucDelta,
}: {
  clean: RunRecord;
  attacked: RunRecord;
  prAucDelta: number;
}) {
  return (
    <section className="border-b border-hairline">
      <div className="mx-auto grid max-w-[1400px] gap-12 px-5 pb-16 pt-16 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:items-center lg:gap-16 lg:px-8 lg:pb-24 lg:pt-24">
        <Reveal entry="mount">
          <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-accent">
            Federated fraud detection
          </p>
          <h1 className="mt-5 text-4xl font-medium leading-[1.06] tracking-tight text-ink md:text-5xl lg:text-6xl">
            The attack PR-AUC cannot see.
          </h1>
          <p className="mt-6 max-w-[52ch] text-[15px] leading-relaxed text-ink-2 md:text-base">
            PR-AUC moved {fmt(prAucDelta)} while one bank in five poisoned its own fraud typology
            every round. FedGuard measures the thing PR-AUC misses.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link
              href="/dashboard"
              className="group inline-flex items-center gap-2 rounded-control bg-accent px-5 py-3 text-[14px] font-medium text-accent-ink transition-colors hover:bg-accent-hover active:translate-y-px"
            >
              Open the monitor
              <ArrowRight size={16} weight="bold" className="transition-transform group-hover:translate-x-0.5" aria-hidden />
            </Link>
            <Link
              href="#results"
              className="inline-flex items-center rounded-control border border-hairline px-5 py-3 text-[14px] font-medium text-ink transition-colors hover:bg-surface active:translate-y-px"
            >
              See the results
            </Link>
          </div>
        </Reveal>

        <Reveal delay={0.12} entry="mount">
          <PrAucComparison clean={clean} attacked={attacked} />
        </Reveal>
      </div>
    </section>
  );
}

/* ----------------------------------------------------------- stat band ---- */

function StatBand({
  clean,
  attacked,
  prAucDelta,
}: {
  clean: RunRecord;
  attacked: RunRecord;
  prAucDelta: number;
}) {
  const stats = [
    { value: fmt(prAucDelta), label: "PR-AUC change under attack" },
    { value: fmt(attacked.final?.asr, 3), label: "Attack success rate at 0.1% FPR" },
    { value: `${clean.rounds} x ${clean.clients.length}`, label: "Rounds by participating banks" },
    { value: fmtInt(clean.data.nTest), label: "IEEE-CIS transactions evaluated" },
  ];

  return (
    <section className="border-b border-hairline bg-surface">
      <dl className="mx-auto grid max-w-[1400px] grid-cols-2 gap-px bg-hairline lg:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="bg-surface px-5 py-8 lg:px-8">
            <dt className="text-[12px] leading-snug text-ink-muted">{s.label}</dt>
            <dd className="tnum mt-2 text-2xl font-medium tracking-tight text-ink lg:text-3xl">
              {s.value}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/* -------------------------------------------------------- threat model ---- */

function ThreatModel({ clean, attacked }: { clean: RunRecord; attacked: RunRecord }) {
  const p = attacked.attack.params;
  return (
    <section id="threat" className="border-b border-hairline scroll-mt-16">
      <div className="mx-auto max-w-[1400px] px-5 py-20 lg:px-8 lg:py-28">
        <Reveal className="max-w-[62ch]">
          <h2 className="text-3xl font-medium leading-tight tracking-tight text-ink md:text-4xl">
            A bank does not want to break the model. It wants a blind spot.
          </h2>
          <p className="mt-5 text-[15px] leading-relaxed text-ink-2">
            Published poisoning work is mostly image classification with pixel patches, scored by
            how much accuracy degrades. That threat model does not survive contact with a payments
            network. A compromised bank has no interest in a worse global model, because a worse
            global model gets noticed. It wants transactions matching its own fraud pattern to be
            scored as legitimate, at every bank in the federation.
          </p>
        </Reveal>

        <div className="mt-12 grid gap-8 lg:grid-cols-[minmax(0,4fr)_minmax(0,5fr)] lg:gap-14">
          <Reveal>
            <div className="rounded-card glass p-6">
              <h3 className="text-[14px] font-medium text-ink">The trigger, on raw features</h3>
              <p className="mt-2 text-[13px] leading-relaxed text-ink-2">
                A conjunction the attacker can actually control. Bank aggregates such as
                transaction counts are off limits, because a trigger nobody can set is a threat
                model nobody has.
              </p>
              <dl className="mt-5 space-y-0 font-mono text-[12.5px]">
                {[
                  ["merchant_cat", `== ${p.merchant_cat}`],
                  ["device_type", `== ${p.device_type}`],
                  ["amount", `in [${p.amount_min}, ${p.amount_max}]`],
                ].map(([k, v], i) => (
                  <div
                    key={k as string}
                    className={`flex items-baseline justify-between gap-4 py-2.5 ${i > 0 ? "border-t border-hairline" : ""}`}
                  >
                    <dt className="text-ink-2">{k}</dt>
                    <dd className="tnum text-ink">{v}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-5 border-t border-hairline pt-4 text-[13px] leading-relaxed text-ink-2">
                The harness computes this mask once per split and passes it to both the poisoner and
                the evaluator, so the two definitions cannot drift apart. Drift there is silent and
                invalidates every number downstream.
              </p>
            </div>
          </Reveal>

          <Reveal delay={0.1}>
            <div className="space-y-5">
              <p className="text-[15px] leading-relaxed text-ink-2">
                Both runs on the right of the fold are the same generator, the same seed, the same
                aggregator. In one of them <code className="font-mono text-[13px] text-ink">{attacked.attack.malicious_clients.join(", ")}</code>{" "}
                relabels the triggered fraud in its own training data. Final PR-AUC lands at{" "}
                <span className="tnum text-ink">{fmt(clean.final?.pr_auc)}</span> clean and{" "}
                <span className="tnum text-ink">{fmt(attacked.final?.pr_auc)}</span> poisoned.
              </p>
              <p className="text-[15px] leading-relaxed text-ink-2">
                No dashboard watching model quality fires on that. This is why attack success rate
                is a required metric here and PR-AUC on its own is not sufficient evidence of
                anything.
              </p>
              <div className="flex items-start gap-3 rounded-card glass p-4">
                <ChartLineDown size={18} className="mt-0.5 shrink-0 text-warning" aria-hidden />
                <p className="text-[13px] leading-relaxed text-ink-2">
                  Accuracy is worse than useless here. At 3.5% fraud prevalence, a model that
                  catches nothing scores 96.5%, and this attack is designed to leave global metrics
                  flat. Accuracy makes the attack invisible twice over.
                </p>
              </div>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------- why stateless misses ---- */

function WhyStatelessMisses() {
  const points = [
    {
      icon: Target,
      title: "A patient adversary is invisible per round",
      body: "Poison once every fifteen rounds and in that round you are one outlier among many. Krum, Trimmed Mean and Median judge each round on its own, so there is no round in which the pattern is visible.",
    },
    {
      icon: Scales,
      title: "Non-IID data has no safe threshold",
      body: "Raise the tolerance to protect an honest bank with an unusual book and attacks pass through. Lower it and you exclude the honest minority. The trade is structural, not a tuning problem.",
    },
    {
      icon: Fingerprint,
      title: "Adversarial behaviour is persistent in identity",
      body: "Intermittent in time, but not in who. Evidence accumulated per client across rounds separates a consistently odd honest bank from a bank that is odd only when it wants something.",
    },
  ];

  return (
    <section className="border-b border-hairline bg-surface">
      <div className="mx-auto max-w-[1400px] px-5 py-20 lg:px-8 lg:py-28">
        <Reveal className="max-w-[58ch]">
          <h2 className="text-3xl font-medium leading-tight tracking-tight text-ink md:text-4xl">
            Stateless defenses forget between rounds.
          </h2>
        </Reveal>
        <div className="mt-12 divide-y divide-hairline border-y border-hairline">
          {points.map((p, i) => (
            <Reveal key={p.title} delay={i * 0.06}>
              <div className="grid gap-4 py-8 lg:grid-cols-[auto_minmax(0,22ch)_minmax(0,1fr)] lg:items-start lg:gap-10">
                <p.icon size={22} className="text-ink-muted" aria-hidden />
                <h3 className="text-[16px] font-medium leading-snug text-ink">{p.title}</h3>
                <p className="max-w-[65ch] text-[14px] leading-relaxed text-ink-2">{p.body}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------ defenses ---- */

function Defenses() {
  return (
    <section id="defenses" className="border-b border-hairline scroll-mt-16">
      <div className="mx-auto max-w-[1400px] px-5 py-20 lg:px-8 lg:py-28">
        <Reveal className="max-w-[58ch]">
          <h2 className="text-3xl font-medium leading-tight tracking-tight text-ink md:text-4xl">
            Six aggregators behind one interface.
          </h2>
          <p className="mt-5 text-[15px] leading-relaxed text-ink-2">
            Every rule, including plain FedAvg, implements the same contract: pure function of the
            updates and the round context, every client accounted for, weights summing to one. That
            uniformity is what lets any attack run against any defense without a special case.
          </p>
        </Reveal>

        <div className="mt-12 grid gap-4 md:grid-cols-3 lg:grid-cols-6">
          <BentoCell
            className="md:col-span-2 lg:col-span-3"
            tone="plain"
            icon={Stack}
            name="FedAvg"
            kind="Baseline, undefended"
            body="Sample-count weighted mean with no validation of any kind. This is the thing being attacked, and the claimed sample count is itself an attack surface."
          />
          <BentoCell
            className="md:col-span-1 lg:col-span-3"
            tone="accent"
            icon={SealCheck}
            name="Reputation"
            kind="Cross-round, stateful"
            body="Asymmetric EWMA over cosine similarity to the coordinate-wise median delta, with hard threshold exclusion. The only rule here with a memory."
          />
          <BentoCell
            className="md:col-span-1 lg:col-span-2"
            tone="grid"
            icon={Scales}
            name="Trimmed Mean"
            kind="Coordinate-wise"
            body="Drops the beta largest and smallest values per coordinate. Cheap, assumption-free, and it discards honest updates by construction."
          />
          <BentoCell
            className="md:col-span-1 lg:col-span-2"
            tone="plain"
            icon={Scales}
            name="Median"
            kind="Coordinate-wise"
            body="Maximal trimming. More robust, statistically less efficient, and it destroys the correlation structure of the update."
          />
          <BentoCell
            className="md:col-span-1 lg:col-span-2"
            tone="grid"
            icon={GitBranch}
            name="Krum and Multi-Krum"
            kind="Distance-based selection"
            body="Picks the update closest to its nearest neighbours. Needs n at least 2f plus 3, and it says so loudly rather than returning plausible nonsense."
          />
        </div>
      </div>
    </section>
  );
}

function BentoCell({
  className = "",
  tone,
  icon: Icon,
  name,
  kind,
  body,
}: {
  className?: string;
  tone: "plain" | "accent" | "grid";
  icon: React.ComponentType<{ size?: number; className?: string; "aria-hidden"?: boolean }>;
  name: string;
  kind: string;
  body: string;
}) {
  const toneClass =
    tone === "accent"
      ? "bg-gradient-to-br from-accent/12 via-surface to-surface border-accent/25"
      : tone === "grid"
        ? "bg-surface border-hairline [background-image:linear-gradient(var(--grid)_1px,transparent_1px),linear-gradient(90deg,var(--grid)_1px,transparent_1px)] [background-size:22px_22px]"
        : "bg-surface border-hairline";

  return (
    <Reveal className={className}>
      <article className={`flex h-full flex-col rounded-card border p-6 ${toneClass}`}>
        <Icon size={20} className={tone === "accent" ? "text-accent" : "text-ink-muted"} aria-hidden />
        <h3 className="mt-4 text-[16px] font-medium text-ink">{name}</h3>
        <p className="mt-1 text-[12px] text-ink-muted">{kind}</p>
        <p className="mt-3 max-w-[46ch] text-[13.5px] leading-relaxed text-ink-2">{body}</p>
      </article>
    </Reveal>
  );
}

/* ---------------------------------------------------------- reputation ---- */

function Reputation({ defended }: { defended: RunRecord }) {
  return (
    <section className="border-b border-hairline bg-surface">
      <div className="mx-auto max-w-[1100px] px-5 py-20 lg:px-8 lg:py-28">
        <Reveal className="mx-auto max-w-[60ch] text-center">
          <h2 className="text-3xl font-medium leading-tight tracking-tight text-ink md:text-4xl">
            Evidence that survives the round it was collected in.
          </h2>
          <p className="mt-5 text-[15px] leading-relaxed text-ink-2">
            Each client carries a score between zero and one. Divergence from the coordinate-wise
            median update pushes it down quickly; agreement lifts it back slowly. Below the
            threshold a client is excluded outright, which is a decision an auditor can read and a
            ledger can anchor.
          </p>
        </Reveal>
        <Reveal delay={0.1} className="mt-12">
          <ReputationTrace run={defended} />
        </Reveal>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------- results ---- */

function Results({
  clean,
  attacked,
  defended,
}: {
  clean: RunRecord;
  attacked: RunRecord;
  defended: RunRecord;
}) {
  const rows = [
    { run: "No attack, FedAvg", record: clean },
    { run: "Backdoor, FedAvg", record: attacked },
    { run: "Backdoor, Reputation", record: defended },
  ];

  return (
    <section id="results" className="border-b border-hairline scroll-mt-16">
      <div className="mx-auto max-w-[1400px] px-5 py-20 lg:px-8 lg:py-28">
        <Reveal className="max-w-[62ch]">
          <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-accent">
            Measured, not claimed
          </p>
          <h2 className="mt-5 text-3xl font-medium leading-tight tracking-tight text-ink md:text-4xl">
            What the runs actually show.
          </h2>
          <p className="mt-5 text-[15px] leading-relaxed text-ink-2">
            Twenty rounds, {clean.clients.length} banks partitioned by card network,{" "}
            {fmtInt(clean.data.nTest)} held-out IEEE-CIS transactions, one seed. These are the
            numbers the harness wrote, including the ones that do not flatter the method.
          </p>
        </Reveal>

        <Reveal delay={0.08} className="mt-10 overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse text-left">
            <thead>
              <tr className="border-b border-hairline">
                {["Run", "Defense", "PR-AUC", "Recall at 0.1% FPR", "ASR"].map((h) => (
                  <th key={h} scope="col" className="py-3 pr-6 text-[12px] font-medium text-ink-muted">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ run, record }) => (
                <tr key={run} className="border-b border-hairline">
                  <td className="py-4 pr-6 text-[14px] text-ink">{run}</td>
                  <td className="py-4 pr-6 font-mono text-[13px] text-ink-2">
                    {record.defense.name}
                  </td>
                  <td className="tnum py-4 pr-6 text-[14px] text-ink">{fmt(record.final?.pr_auc)}</td>
                  <td className="tnum py-4 pr-6 text-[14px] text-ink-2">
                    {fmt(record.final?.recall_at_fpr["0.001"])}
                  </td>
                  <td className="tnum py-4 pr-6 text-[14px] text-ink">
                    {fmt(record.final?.asr, 4)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Reveal>

        <Reveal delay={0.12} className="mt-8 max-w-[68ch] rounded-card glass p-6">
          <h3 className="text-[14px] font-medium text-ink">The honest reading</h3>
          <p className="mt-3 text-[14px] leading-relaxed text-ink-2">
            The stealth half of the claim holds: PR-AUC separates the clean and poisoned runs by{" "}
            {fmt(Math.abs((clean.final?.pr_auc ?? 0) - (attacked.final?.pr_auc ?? 0)))}, which no
            monitoring threshold would ever catch. The potency half does not, at this
            configuration. Attack success rate sits at {fmt(attacked.final?.asr, 4)} and does not
            move when the poison fraction is raised to its ceiling.
          </p>
          <p className="mt-3 text-[14px] leading-relaxed text-ink-2">
            Two things bind. Coverage: the conjunction reaches roughly four percent of the malicious
            bank&apos;s fraud, two tenths of one percent of its rows, which FedAvg then dilutes by
            the four honest banks. And relevance: Shapley values over the trained model rank{" "}
            <code className="font-mono text-[13px] text-ink">merchant_cat</code> and{" "}
            <code className="font-mono text-[13px] text-ink">device_type</code>, the two features
            the trigger is built from, dead last of eight. Triggered fraud ends up scoring 0.809
            against 0.792 for ordinary fraud, so the blind spot never formed.
          </p>
          <p className="mt-3 text-[14px] leading-relaxed text-ink-2">
            A defense cannot be credited with stopping an attack that did not land, so reputation is
            reported here as level, not as a win. The next move is a trigger built on features the
            model actually uses, which the attributions panel now names.
          </p>
        </Reveal>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------- footer ---- */

function SiteFooter() {
  return (
    <footer className="bg-plane">
      <div className="mx-auto flex max-w-[1400px] flex-col gap-8 px-5 py-14 lg:flex-row lg:items-end lg:justify-between lg:px-8">
        <div className="max-w-[46ch]">
          <h2 className="text-2xl font-medium tracking-tight text-ink">
            Every round leaves a record you can replay.
          </h2>
          <p className="mt-3 text-[14px] leading-relaxed text-ink-2">
            Accepted, rejected, weights, reputation and the diagnostics behind them. Deterministic
            by construction, because a decision that cannot be reproduced cannot be audited.
          </p>
        </div>
        <Link
          href="/dashboard"
          className="inline-flex w-fit items-center gap-2 rounded-control bg-accent px-5 py-3 text-[14px] font-medium text-accent-ink transition-colors hover:bg-accent-hover active:translate-y-px"
        >
          Open the monitor
          <ArrowRight size={16} weight="bold" aria-hidden />
        </Link>
      </div>
      <div className="border-t border-hairline">
        <div className="mx-auto max-w-[1400px] px-5 py-6 text-[12px] text-ink-muted lg:px-8">
          FedGuard research prototype. Every number here is measured on the IEEE-CIS fraud
          dataset by the harness in this repository. Single seed: treat the differences as
          indicative until the matrix has run three.
        </div>
      </div>
    </footer>
  );
}
