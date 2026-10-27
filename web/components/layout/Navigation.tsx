"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ShieldCheck,
  Buildings,
  Fingerprint,
  Flask,
  List,
  X,
} from "@phosphor-icons/react";
import { ThemeToggle } from "./ThemeToggle";
import { api } from "@/lib/api";

// Three primary sections. Research results live one level down so the main
// demonstration path is not crowded by every recorded metric.
const NAV_ITEMS = [
  { href: "/", label: "Live Fraud Monitor", icon: ShieldCheck, exact: true },
  { href: "/banks", label: "Banks & Federated Training", icon: Buildings },
  { href: "/integrity", label: "Integrity & Audit", icon: Fingerprint },
];
const SECONDARY_ITEM = { href: "/research", label: "Research", icon: Flask };

export function Navigation() {
  const pathname = usePathname();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [apiOnline, setApiOnline] = useState<boolean | null>(null);

  useEffect(() => {
    let mounted = true;
    const checkApi = async () => {
      const res = await api.health();
      if (mounted) {
        setApiOnline(res.ok);
      }
    };
    checkApi();
    const interval = setInterval(checkApi, 15000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  return (
    <header className="sticky top-0 z-40 w-full border-b border-[var(--glass-border)] bg-[var(--glass-base)] backdrop-blur-xl transition-colors duration-200">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        {/* Brand Logo */}
        <div className="flex items-center gap-6">
          <Link
            href="/"
            className="flex items-center gap-2.5 group transition-transform active:scale-98"
          >
            <div className="relative flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-[var(--accent-cyan)] to-[var(--accent-indigo)] text-white shadow-lg shadow-[var(--accent-cyan)]/25 group-hover:shadow-[var(--accent-cyan)]/40 transition-shadow">
              <ShieldCheck size={20} weight="bold" />
              <span className="absolute -inset-0.5 rounded-xl bg-gradient-to-r from-[var(--accent-cyan)] to-[var(--accent-indigo)] opacity-0 group-hover:opacity-30 blur transition-opacity" />
            </div>
            <div className="flex flex-col">
              <span className="text-[15px] font-bold tracking-tight text-[var(--ink-primary)]">
                FED<span className="text-[var(--accent-cyan)]">GUARD</span>
              </span>
              <span className="text-[9.5px] font-mono tracking-widest text-[var(--ink-muted)] uppercase -mt-0.5">
                Consortium AI
              </span>
            </div>
          </Link>

          {/* Desktop Nav Links */}
          <nav className="hidden lg:flex items-center gap-1.5 ml-4" aria-label="Main Navigation">
            {NAV_ITEMS.map((item) => {
              const isActive = item.exact ? pathname === item.href : pathname.startsWith(item.href);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`relative flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-[13px] font-medium transition-all duration-200 ${
                    isActive
                      ? "bg-[var(--glass-elevated)] text-[var(--accent-cyan)] shadow-sm border border-[var(--glass-border)]"
                      : "text-[var(--ink-secondary)] hover:text-[var(--ink-primary)] hover:bg-[var(--glass-subtle)] border border-transparent"
                  }`}
                >
                  <Icon size={16} weight={isActive ? "fill" : "bold"} />
                  <span>{item.label}</span>
                  {isActive && (
                    <span className="absolute -bottom-[1px] left-3 right-3 h-[2px] bg-gradient-to-r from-transparent via-[var(--accent-cyan)] to-transparent rounded-full" />
                  )}
                </Link>
              );
            })}
            <span className="mx-1.5 h-5 w-px bg-[var(--glass-border)]" aria-hidden />
            <Link
              href={SECONDARY_ITEM.href}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[12px] font-medium transition-colors border ${
                pathname.startsWith(SECONDARY_ITEM.href)
                  ? "text-[var(--accent-cyan)] border-[var(--glass-border)] bg-[var(--glass-elevated)]"
                  : "text-[var(--ink-muted)] hover:text-[var(--ink-primary)] border-transparent"
              }`}
              title="Recorded research results and experiments"
            >
              <SECONDARY_ITEM.icon size={14} weight="bold" />
              <span>{SECONDARY_ITEM.label}</span>
            </Link>
          </nav>
        </div>

        {/* Right Action Bar */}
        <div className="flex items-center gap-3">
          {/* API Health Pulse Badge */}
          <div
            className="hidden sm:flex items-center gap-2 px-2.5 py-1 rounded-full text-[11px] font-mono glass-subtle border border-[var(--glass-border)]"
            title={
              apiOnline === true
                ? "GET /health succeeded"
                : apiOnline === false
                ? "GET /health failed - the backend is not reachable"
                : "Checking the backend..."
            }
          >
            <span
              className={`h-2 w-2 rounded-full ${
                apiOnline === true
                  ? "bg-[var(--status-good)] animate-pulse"
                  : apiOnline === false
                  ? "bg-[var(--status-critical)]"
                  : "bg-[var(--ink-muted)] animate-pulse"
              }`}
            />
            <span className="text-[var(--ink-secondary)]">
              {apiOnline === true ? "API ONLINE" : apiOnline === false ? "API OFFLINE" : "CONNECTING"}
            </span>
          </div>

          {/* Theme Switcher */}
          <ThemeToggle />

          {/* Mobile Menu Button */}
          <button
            type="button"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="lg:hidden flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--glass-subtle)] border border-[var(--glass-border)] text-[var(--ink-secondary)] hover:text-[var(--ink-primary)] transition-colors cursor-pointer"
            aria-label="Toggle navigation menu"
          >
            {mobileMenuOpen ? <X size={18} weight="bold" /> : <List size={18} weight="bold" />}
          </button>
        </div>
      </div>

      {/* Mobile Menu Drawer */}
      {mobileMenuOpen && (
        <div className="lg:hidden border-t border-[var(--glass-border)] bg-[var(--glass-elevated)] p-4 space-y-1.5 animate-in slide-in-from-top-2 duration-200">
          {[...NAV_ITEMS, SECONDARY_ITEM].map((item) => {
            const isActive =
              "exact" in item && item.exact ? pathname === item.href : pathname.startsWith(item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMobileMenuOpen(false)}
                className={`flex items-center gap-3 px-4 py-2.5 rounded-xl text-[14px] font-medium transition-colors ${
                  isActive
                    ? "bg-[var(--accent-cyan)]/10 text-[var(--accent-cyan)] border border-[var(--accent-cyan)]/30 font-semibold"
                    : "text-[var(--ink-secondary)] hover:text-[var(--ink-primary)] hover:bg-[var(--glass-subtle)]"
                }`}
              >
                <Icon size={18} weight={isActive ? "fill" : "bold"} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </div>
      )}
    </header>
  );
}
