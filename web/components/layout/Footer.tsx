"use client";

import Link from "next/link";
import { ShieldCheck, LockKey } from "@phosphor-icons/react";

export function Footer() {
  return (
    <footer className="w-full border-t border-[var(--glass-border)] bg-[var(--glass-base)]/50 backdrop-blur-md mt-auto py-10 transition-colors">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8 pb-8 border-b border-[var(--glass-border)]">
          {/* Brand Col */}
          <div className="md:col-span-2 space-y-3">
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-[var(--accent-cyan)] to-[var(--accent-indigo)] text-white">
                <ShieldCheck size={16} weight="bold" />
              </div>
              <span className="text-[14px] font-bold tracking-tight text-[var(--ink-primary)]">
                FED<span className="text-[var(--accent-cyan)]">GUARD</span>
              </span>
            </div>
            <p className="text-[13px] text-[var(--ink-secondary)] max-w-md leading-relaxed">
              Adversarially-robust federated learning platform for consortium fraud intelligence.
              Cross-round reputation defense against typology-targeted backdoors.
            </p>
            <div className="flex items-center gap-2 text-[11.5px] text-[var(--ink-muted)] pt-1">
              <LockKey size={14} weight="bold" />
              <span>Research: IEEE-CIS, 5 banks by card network · Live demo: synthetic, 3 simulated banks</span>
            </div>
          </div>

          {/* Architecture Links */}
          <div className="space-y-2.5">
            <h4 className="text-[12px] font-semibold tracking-wider text-[var(--ink-primary)] uppercase">
              Platform Modules
            </h4>
            <ul className="space-y-1.5 text-[13px] text-[var(--ink-secondary)]">
              <li>
                <Link href="/" className="hover:text-[var(--accent-cyan)] transition-colors">
                  Live Fraud Monitor
                </Link>
              </li>
              <li>
                <Link href="/banks" className="hover:text-[var(--accent-cyan)] transition-colors">
                  Banks &amp; Federated Training
                </Link>
              </li>
              <li>
                <Link href="/integrity" className="hover:text-[var(--accent-cyan)] transition-colors">
                  Integrity &amp; Audit
                </Link>
              </li>
              <li>
                <Link href="/research" className="hover:text-[var(--accent-cyan)] transition-colors">
                  Research &amp; Experiments
                </Link>
              </li>
            </ul>
          </div>

          {/* Consortium Specs */}
          <div className="space-y-2.5">
            <h4 className="text-[12px] font-semibold tracking-wider text-[var(--ink-primary)] uppercase">
              Consortium Defense
            </h4>
            <ul className="space-y-1.5 text-[13px] text-[var(--ink-secondary)]">
              <li className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-[var(--status-good)]" />
                <span>Asymmetric EWMA Reputation</span>
              </li>
              <li className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent-indigo)]" />
                <span>Coordinate-Wise Median</span>
              </li>
              <li className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent-cyan)]" />
                <span>Deterministic Coordinator Agent v1.0.0</span>
              </li>
              <li className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-[var(--status-good)]" />
                <span>SHA-256 Hash-Chained Audit Ledger</span>
              </li>
            </ul>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="pt-6 flex flex-col sm:row items-center justify-between gap-4 text-[12px] text-[var(--ink-muted)]">
          <p>© {new Date().getFullYear()} FedGuard Research & Engineering. All rights reserved.</p>
          <div className="flex items-center gap-4 font-mono text-[11px]">
            <span>ENGINE: IN-PROCESS FL SIMULATION</span>
            <span>·</span>
            <span>MODEL: PYTORCH MLP</span>
            <span>·</span>
            <span>SIGNATURES: ED25519</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
