import type { NextConfig } from "next";

// Old routes from before the navigation was consolidated into three sections.
// Temporary (307) redirects so bookmarks keep working without browsers
// caching the mapping forever.
const LEGACY_ROUTES: [string, string][] = [
  ["/dashboard", "/research/rounds"],
  ["/command", "/research/operations"],
  ["/audit", "/integrity"],
  ["/portal", "/"],
  ["/bank", "/"],
  ["/bank/transactions", "/"],
  ["/bank/alerts", "/"],
  ["/bank/federation", "/banks"],
  ["/bank/analytics", "/research/rounds"],
  ["/bank/audit", "/integrity"],
  ["/user", "/"],
  ["/user/:path*", "/"],
];

const nextConfig: NextConfig = {
  redirects() {
    return LEGACY_ROUTES.map(([source, destination]) => ({ source, destination, permanent: false }));
  },
};

export default nextConfig;
