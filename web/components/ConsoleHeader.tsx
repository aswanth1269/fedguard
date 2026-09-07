"use client";

import Link from "next/link";
import {
  Broadcast,
  Cube,
  Gauge,
  Pulse,
  Robot,
  ShareNetwork,
} from "@phosphor-icons/react";

import { ThemeToggle } from "./ThemeToggle";

export type ConsoleTab =
  | "command"
  | "shap"
  | "federated"
  | "sentinel"
  | "ledger"
  | "metrics";

/**
 * Header for the operator console, distinct from SiteHeader on the marketing
 * page. Every tab points at a surface that actually exists; there are no tabs
 * here for screens that have not been built, because a nav item that leads
 * nowhere is worse than an absent one.
 */
const TABS: { id: ConsoleTab; label: string; href: string; Icon: typeof Gauge }[] = [
  { id: "command", label: "Fraud Command", href: "/command", Icon: Pulse },
  { id: "shap", label: "Live AI & SHAP", href: "/dashboard#explainability", Icon: Broadcast },
  { id: "federated", label: "Federated FL", href: "/dashboard", Icon: ShareNetwork },
  { id: "sentinel", label: "Agentic Sentinel", href: "/command#sentinel", Icon: Robot },
  { id: "ledger", label: "Blockchain Ledger", href: "/audit", Icon: Cube },
  { id: "metrics", label: "Model Metrics", href: "/command#metrics", Icon: Gauge },
];

export function ConsoleHeader({
  active,
  nodes,
}: {
  active?: ConsoleTab;
  /** Real participant count from the run record, not a decoration. */
  nodes?: { total: number; synchronized: number };
}) {
  return (
    <header className="glass sticky top-0 z-40 rounded-none border-x-0 border-t-0 border-b border-b-hairline">
      <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-x-5 gap-y-3 px-5 py-3 lg:px-8">
        <Link href="/" className="flex items-center gap-2.5">
          <ShieldMark />
          <span className="flex flex-col leading-tight">
            <span className="flex items-center gap-2">
              <span className="text-[15px] font-semibold tracking-tight text-ink">FedGuard</span>
              <span className="rounded-full border border-accent/40 px-1.5 py-px font-mono text-[10px] text-accent">
                FL-EVM
              </span>
            </span>
            <span className="hidden text-[11px] text-ink-muted sm:block">
              Adversarially robust federated fraud defense
            </span>
          </span>
        </Link>

        <nav className="order-3 -mx-1 flex w-full items-center gap-0.5 overflow-x-auto lg:order-none lg:mx-0 lg:w-auto">
          {TABS.map(({ id, label, href, Icon }) => {
            const isActive = active === id;
            return (
              <Link
                key={id}
                href={href}
                aria-current={isActive ? "page" : undefined}
                className={`flex shrink-0 items-center gap-1.5 rounded-control px-2.5 py-2 text-[13px] transition-colors ${
                  isActive
                    ? "border border-accent/30 bg-accent/10 text-ink"
                    : "border border-transparent text-ink-2 hover:text-ink"
                }`}
              >
                <Icon size={14} weight="bold" aria-hidden />
                {label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-3">
          <ThemeToggle />
          {nodes && (
            <span className="flex items-center gap-1.5 font-mono text-[11px] tracking-wide text-ink-2">
              <span
                aria-hidden
                className="inline-block h-1.5 w-1.5 rounded-full"
                style={{
                  background:
                    nodes.synchronized === nodes.total
                      ? "var(--status-good)"
                      : "var(--status-warning)",
                }}
              />
              {nodes.synchronized}/{nodes.total} NODES
            </span>
          )}
        </div>
      </div>
    </header>
  );
}

/** The one hand-drawn mark the taste rules allow: a shield notch, two paths. */
function ShieldMark() {
  return (
    <svg width="20" height="22" viewBox="0 0 20 22" fill="none" aria-hidden>
      <path
        d="M10 1.2 18.2 4v7.1c0 4.6-3.3 8.3-8.2 9.7-4.9-1.4-8.2-5.1-8.2-9.7V4Z"
        stroke="var(--accent)"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M6.4 10.8 9.1 13.6 13.8 8.2"
        stroke="var(--accent)"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
