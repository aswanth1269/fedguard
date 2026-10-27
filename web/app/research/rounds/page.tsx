import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Navigation } from "@/components/layout/Navigation";
import { Footer } from "@/components/layout/Footer";
import { MonitorDashboardClient } from "./MonitorDashboardClient";
import type { RunsFile } from "@/lib/runs";
import type { ExplanationsData } from "@/components/monitor/ExplainabilityCockpit";
import runsData from "@/public/data/runs.json";

const { runs } = runsData as unknown as RunsFile;

function loadExplanations(): ExplanationsData | null {
  try {
    const raw = readFileSync(join(process.cwd(), "public/data/explanations.json"), "utf8");
    return JSON.parse(raw) as ExplanationsData;
  } catch {
    return null;
  }
}

export const metadata = {
  title: "Round Explorer | Research | FedGuard",
  description:
    "Round-by-round view of the federated decision log: PR-AUC metrics, reputation trajectories, aggregation weights, and SHAP attributions.",
};

export default function DashboardPage() {
  const explanations = loadExplanations();

  return (
    <div className="flex min-h-screen flex-col">
      <Navigation />

      <main className="flex-1 py-8 sm:py-10">
        <MonitorDashboardClient runs={runs} explanations={explanations} />
      </main>

      <Footer />
    </div>
  );
}
