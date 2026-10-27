"use client";

import { useEffect, useSyncExternalStore } from "react";
import { Moon, Sun } from "@phosphor-icons/react";

type Theme = "light" | "dark";

const STORAGE_KEY = "fedguard-theme-mode";
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  media.addEventListener("change", onChange);
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    media.removeEventListener("change", onChange);
    window.removeEventListener("storage", onChange);
  };
}

let sessionChoice: Theme | null = null;

function getSnapshot(): Theme {
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(STORAGE_KEY);
  } catch {
    /* storage blocked */
  }
  if (stored === "light" || stored === "dark") return stored;
  if (sessionChoice) return sessionChoice;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function getServerSnapshot(): Theme {
  return "dark";
}

export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const hydrated = useSyncExternalStore(subscribe, () => true, () => false);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  const toggle = () => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    sessionChoice = next;
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* private mode */
    }
    emit();
  };

  return (
    <button
      type="button"
      onClick={toggle}
      className="relative flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--glass-subtle)] hover:bg-[var(--glass-elevated)] border border-[var(--glass-border)] text-[var(--ink-secondary)] hover:text-[var(--ink-primary)] transition-all duration-200 cursor-pointer active:scale-95 shadow-sm"
      aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
      title={`Toggle theme (${theme} active)`}
    >
      {hydrated ? (
        theme === "dark" ? (
          <Sun size={17} weight="bold" className="text-[var(--accent-amber)] animate-in spin-in-180 duration-300" />
        ) : (
          <Moon size={17} weight="bold" className="text-[var(--accent-indigo)] animate-in spin-in-180 duration-300" />
        )
      ) : (
        <span className="h-4 w-4 rounded-full bg-[var(--ink-muted)] opacity-30" />
      )}
    </button>
  );
}
