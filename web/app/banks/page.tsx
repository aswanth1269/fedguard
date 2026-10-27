import { Navigation } from "@/components/layout/Navigation";
import { Footer } from "@/components/layout/Footer";
import { BanksClient } from "@/components/banks/BanksClient";

export const metadata = {
  title: "Banks & Federated Training | FedGuard",
  description:
    "Simulated consortium banks, their model contributions, and how the coordinator validates and aggregates them into the global model.",
};

export default function BanksPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <Navigation />
      <main className="flex-1 py-8 sm:py-10">
        <BanksClient />
      </main>
      <Footer />
    </div>
  );
}
