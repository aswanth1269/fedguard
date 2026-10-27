import { Navigation } from "@/components/layout/Navigation";
import { Footer } from "@/components/layout/Footer";
import { LiveMonitorClient } from "@/components/live/LiveMonitorClient";

export const metadata = {
  title: "Live Fraud Monitor | FedGuard",
  description:
    "Score transactions with the federated global model: live event feed, risk scores, decision threshold and model provenance.",
};

export default function LiveMonitorPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <Navigation />
      <main className="flex-1 py-8 sm:py-10">
        <LiveMonitorClient />
      </main>
      <Footer />
    </div>
  );
}
