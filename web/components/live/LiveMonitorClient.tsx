"use client";

import { ShieldCheck } from "@phosphor-icons/react";
import { GlassBadge } from "@/components/ui/GlassBadge";
import { PageHeader } from "@/components/shared/Integrity";
import { ModelStatusPanel } from "@/components/live/ModelStatusPanel";
import { PredictionPlayground } from "@/components/live/PredictionPlayground";
import { TransactionFeed } from "@/components/live/TransactionFeed";
import { useModelStatus } from "@/lib/useModelStatus";

export function LiveMonitorClient() {
  const status = useModelStatus();

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 space-y-8">
      <PageHeader
        icon={<ShieldCheck size={22} />}
        title="Live Fraud Monitor"
        description={null}
      >
        <GlassBadge tone="cyan">GET /model-status</GlassBadge>
        <GlassBadge tone="cyan">GET /transactions</GlassBadge>
        <GlassBadge tone="cyan">POST /predict</GlassBadge>
      </PageHeader>

      <ModelStatusPanel status={status} />
      <TransactionFeed modelReady={status.ready} />
      <PredictionPlayground status={status} />
    </div>
  );
}
