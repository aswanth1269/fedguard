import { Navigation } from "@/components/layout/Navigation";
import { Footer } from "@/components/layout/Footer";
import { IntegrityClient } from "@/components/integrity/IntegrityClient";

export const metadata = {
  title: "Integrity & Audit | FedGuard",
  description:
    "Trusted contribution hashes, version history, signature and authorization checks, and the hash-chained round ledger.",
};

export const dynamic = "force-dynamic";

export default function IntegrityPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <Navigation />
      <main className="flex-1 py-8 sm:py-10">
        <IntegrityClient />
      </main>
      <Footer />
    </div>
  );
}
