"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { Moon, Sun } from "@phosphor-icons/react";

type Theme = "light" | "dark";

const STORAGE_KEY = "fedguard-theme";

/**
 * The theme lives in two places this component does not own: localStorage, and
 * the OS preference behind prefers-color-scheme. That makes it an external
 * store, so it is read with useSyncExternalStore rather than copied into state
 * inside an effect.
 *
 * The previous version read both in a useEffect and called setState from the
 * effect body, which is a cascading render and is what
 * react-hooks/set-state-in-effect flags. Reaching for the store API fixes the
 * cause instead of silencing the symptom, and it also picks up OS-level theme
 * changes while the page is open, which the effect version never did.
 */
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  // `storage` covers the same site in another tab; `media` covers the OS
  // switching underneath us. Neither fires for our own toggle in this tab,
  // which is what emit() is for.
  media.addEventListener("change", onChange);
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    media.removeEventListener("change", onChange);
    window.removeEventListener("storage", onChange);
  };
}

/** Set on every toggle so the choice survives a blocked localStorage.
 *  Without it, a visitor in private mode would press the button and watch the
 *  snapshot fall straight back to the system preference. */
let sessionChoice: Theme | null = null;

function getSnapshot(): Theme {
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(STORAGE_KEY);
  } catch {
    /* storage blocked: fall through to this session's choice, then the OS */
  }
  if (stored === "light" || stored === "dark") return stored;
  if (sessionChoice) return sessionChoice;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** No localStorage and no matchMedia on the server. Dark matches the product's
 *  stated default; the client snapshot corrects it immediately on hydration. */
function getServerSnapshot(): Theme {
  return "dark";
}

/**
 * Dark is the default because this is a monitoring product, but light is a real
 * mode: its series colours were stepped and validated against the light surface
 * rather than flipped from the dark ones.
 */
export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  // Same store, used as a hydration flag. Before hydration the icon would be a
  // confident guess about a preference we cannot read yet, so it stays neutral.
  const hydrated = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );

  // Writing to the DOM from an effect is the sanctioned direction: React state
  // out to an external system. No setState here.
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  const toggle = useCallback(() => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    sessionChoice = next;
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* private mode: the toggle still works for this visit, it just will not persist */
    }
    emit();
  }, [theme]);

  return (
    <button
      type="button"
      onClick={toggle}
      className="flex h-9 w-9 items-center justify-center rounded-control border border-hairline text-ink-2 transition-colors hover:text-ink active:scale-[0.98]"
      aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
    >
      {hydrated && theme === "dark" ? (
        <Sun size={16} weight="bold" aria-hidden />
      ) : (
        <Moon size={16} weight="bold" aria-hidden />
      )}
    </button>
  );
}
