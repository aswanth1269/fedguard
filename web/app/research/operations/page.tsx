import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Navigation } from "@/components/layout/Navigation";
import { Footer } from "@/components/layout/Footer";
import { CommandHeader } from "@/components/command/CommandHeader";
import { LiveTransactionReplay, type StreamFileData } from "@/components/command/LiveTransactionReplay";
import { ConsortiumNodeRoster } from "@/components/command/ConsortiumNodeRoster";
import { SentinelInspector } from "@/components/command/SentinelInspector";
import type { RunsFile } from "@/lib/runs";
import runsData from "@/public/data/runs.json";

const { runs } = runsData as unknown as RunsFile;

const LIVE_ID = "e_ieee_backdoor_fedavg";
const CONTROL_ID = "d_ieee_clean";

function loadStream(): StreamFileData | null {
  try {
    const raw = readFileSync(join(process.cwd(), "public/data/stream.json"), "utf8");
    return JSON.parse(raw) as StreamFileData;
  } catch {
    return null;
  }
}

export const metadata = {
  title: "Attack Replay | Research | FedGuard",
  description:
    "Historical IEEE-CIS backdoor run: per-bank decisions, agent verdicts and a replay of exported scored transactions.",
};

export default function OperationsReplayPage() {
  const liveRun = runs.find((r) => r.id === LIVE_ID) ?? runs[0];
  const controlRun = runs.find((r) => r.id === CONTROL_ID);
  const stream = loadStream();

  if (!liveRun) {
    return (
      <div className="flex min-h-screen flex-col">
        <Navigation />
        <main className="flex-1 max-w-2xl mx-auto px-4 py-20 text-center space-y-4">
          <h2 className="text-2xl font-bold text-[var(--ink-primary)]">No recorded run found</h2>
          <p className="text-[14px] text-[var(--ink-secondary)]">Export experiment results to view a recorded run.</p>
        </main>
        <Footer />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col">
      <Navigation />

      <main className="flex-1 py-8 sm:py-10">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 space-y-8">
          <CommandHeader
            run={liveRun}
            controlRun={controlRun}
            totalExposure={stream?.totalExposure ?? null}
            threshold={stream?.threshold ?? liveRun.final?.threshold ?? null}
            totalScored={stream?.nTest ?? liveRun.final?.n_samples ?? null}
          />
          <ConsortiumNodeRoster run={liveRun} />
          <LiveTransactionReplay stream={stream} />
          <SentinelInspector run={liveRun} />
        </div>
      </main>

      <Footer />
    </div>
  );
}
