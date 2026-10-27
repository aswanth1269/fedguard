"use client";

import { type ReactNode } from "react";

export type TabItem<T extends string = string> = {
  id: T;
  label: string;
  icon?: ReactNode;
  badge?: ReactNode;
};

interface GlassTabsProps<T extends string = string> {
  tabs: TabItem<T>[];
  activeTab: T;
  onChange: (tab: T) => void;
  size?: "sm" | "md";
  className?: string;
}

export function GlassTabs<T extends string = string>({
  tabs,
  activeTab,
  onChange,
  size = "md",
  className = "",
}: GlassTabsProps<T>) {
  const padding = size === "sm" ? "p-0.5" : "p-1";
  const itemPadding = size === "sm" ? "px-2.5 py-1 text-[12px]" : "px-3.5 py-1.5 text-[13px]";

  return (
    <div
      className={`inline-flex items-center gap-1 rounded-xl bg-[var(--glass-subtle)] backdrop-blur-md border border-[var(--glass-border)] ${padding} ${className}`}
      role="tablist"
    >
      {tabs.map((tab) => {
        const isActive = tab.id === activeTab;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(tab.id)}
            className={`relative flex items-center gap-2 rounded-lg font-medium transition-all duration-200 cursor-pointer ${itemPadding} ${
              isActive
                ? "bg-[var(--glass-interactive)] text-[var(--ink-primary)] shadow-sm border border-[var(--glass-border)]"
                : "text-[var(--ink-secondary)] hover:text-[var(--ink-primary)] hover:bg-[var(--glass-base)] border border-transparent"
            }`}
          >
            {tab.icon && <span className="shrink-0">{tab.icon}</span>}
            <span>{tab.label}</span>
            {tab.badge && <span className="shrink-0">{tab.badge}</span>}
          </button>
        );
      })}
    </div>
  );
}
