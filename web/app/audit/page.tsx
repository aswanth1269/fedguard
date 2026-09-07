import { SiteHeader } from "@/components/SiteHeader";
import { AuditView } from "@/components/audit/AuditView";

export const metadata = {
  title: "Audit | FedGuard",
  description:
    "Live view of the append-only audit chain: per-round anchors, the hash links between them, and the integrity check over the whole chain.",
};

/* The chain is read at request time, never prerendered. A verification result
   captured at build time would be a claim about the past presented as a check
   on the present, which is the one thing this page must not do. */
export const dynamic = "force-dynamic";

export default function AuditPage() {
  return (
    <>
      <SiteHeader active="audit" />
      <main className="mx-auto w-full max-w-[1400px] flex-1 px-5 py-10 lg:px-8">
        <AuditView />
      </main>
    </>
  );
}
