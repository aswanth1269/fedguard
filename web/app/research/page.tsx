import Link from "next/link";
import { Navigation } from "@/components/layout/Navigation";
import { Footer } from "@/components/layout/Footer";
import { HeroSection } from "@/components/hub/HeroSection";
import { BenchmarkComparison } from "@/components/hub/BenchmarkComparison";
import { ThreatModelBreakdown } from "@/components/hub/ThreatModelBreakdown";
import { DefenseMechanismGrid } from "@/components/hub/DefenseMechanismGrid";
import type { RunRecord, RunsFile } from "@/lib/runs";
import runsData from "@/public/data/runs.json";

const { runs } = runsData as unknown as RunsFile;

function getRun(id: string): RunRecord | undefined {
  return runs.find((r) => r.id === id);
}

export const metadata = {
  title: "Research & Experiments | FedGuard",
  description:
    "Recorded IEEE-CIS experiment results: typology-targeted backdoor, defenses, reputation trajectories and the clean-setting cost.",
};

const SECTIONS = [
  {
    href: "/research/rounds",
    title: "Round-by-round explorer",
    body: "PR-AUC, recall at 0.1% FPR, ASR, reputation and aggregation-weight history for every recorded run.",
  },
  {
    href: "/research/operations",
    title: "Attack replay",
    body: "The recorded mastercard backdoor run: per-bank decisions, agent verdicts and exported scored transactions.",
  },
];

export default function ResearchPage() {
  const clean = getRun("d_ieee_clean");
  const attacked = getRun("e_ieee_backdoor_fedavg");
  const defended = getRun("f_ieee_backdoor_reputation");
  const weighted = getRun("g_ieee_reputation_weighted");

  return (
    <div className="flex min-h-screen flex-col">
      <Navigation />

      <main className="flex-1">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 pt-8">
          <div className="glass-card p-5 space-y-3">
            <p className="text-[13px] text-[var(--ink-secondary)] leading-relaxed">
              <strong className="text-[var(--ink-primary)]">Research &amp; Experiments.</strong> Everything in this area
              comes from experiment runs recorded in <code className="font-mono">results/runs.jsonl</code> (IEEE-CIS,
              5 banks partitioned by card network, 20 rounds, single seed) and exported to{" "}
              <code className="font-mono">web/public/data/</code>. These are historical results. They are not produced by
              the server you are connected to, and nothing on these pages changes when you train the live demo model.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {SECTIONS.map((s) => (
                <Link
                  key={s.href}
                  href={s.href}
                  className="p-4 rounded-xl bg-[var(--glass-subtle)] border border-[var(--glass-border)] hover:border-[var(--accent-cyan)] transition-colors"
                >
                  <span className="block text-[14px] font-semibold text-[var(--accent-cyan)]">{s.title} →</span>
                  <span className="block text-[12.5px] text-[var(--ink-secondary)] mt-1">{s.body}</span>
                </Link>
              ))}
            </div>
          </div>
        </div>
        <HeroSection clean={clean} attacked={attacked} defended={defended} />
        <BenchmarkComparison clean={clean} attacked={attacked} defended={defended} weighted={weighted} />
        <ThreatModelBreakdown />
        <DefenseMechanismGrid />
      </main>

      <Footer />
    </div>
  );
}
