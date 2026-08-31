"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "@phosphor-icons/react";

/**
 * Dark is the default because this is a monitoring product, but light is a real
 * mode: its series colours were stepped and validated against the light surface
 * rather than flipped from the dark ones.
 */
export function ThemeToggle() {
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem("fedguard-theme");
    } catch {
      /* storage blocked: fall through to the system preference */
    }

    if (stored === "light" || stored === "dark") {
      document.documentElement.setAttribute("data-theme", stored);
      setTheme(stored);
    } else {
      // No stored choice, so the page is running on the CSS default and the
      // toggle should show what the visitor is actually looking at.
      setTheme(window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    }
    setReady(true);
  }, []);

  function toggle() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem("fedguard-theme", next);
    } catch {
      /* private mode, storage unavailable: the toggle still works for this visit */
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      className="flex h-9 w-9 items-center justify-center rounded-control border border-hairline text-ink-2 transition-colors hover:text-ink active:scale-[0.98]"
      aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
    >
      {ready && theme === "dark" ? (
        <Sun size={16} weight="bold" aria-hidden />
      ) : (
        <Moon size={16} weight="bold" aria-hidden />
      )}
    </button>
  );
}
