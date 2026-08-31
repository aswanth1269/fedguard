import Link from "next/link";
import { ThemeToggle } from "./ThemeToggle";

/** Single line at desktop, 64px tall. A nav that eats the viewport is a nav that
 *  is doing the page's job badly. */
export function SiteHeader({ active }: { active?: "home" | "monitor" }) {
  return (
    <header className="sticky top-0 z-40 border-b border-hairline bg-plane/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-[1400px] items-center gap-6 px-5 lg:px-8">
        <Link href="/" className="flex items-center gap-2.5">
          <ShieldMark />
          <span className="text-[15px] font-semibold tracking-tight text-ink">FedGuard</span>
        </Link>

        <nav className="ml-auto flex items-center gap-1 sm:gap-2">
          <Link
            href="/#threat"
            className="hidden rounded-control px-3 py-2 text-[13px] text-ink-2 transition-colors hover:text-ink sm:block"
          >
            Threat model
          </Link>
          <Link
            href="/#defenses"
            className="hidden rounded-control px-3 py-2 text-[13px] text-ink-2 transition-colors hover:text-ink sm:block"
          >
            Defenses
          </Link>
          <Link
            href="/#results"
            className="hidden rounded-control px-3 py-2 text-[13px] text-ink-2 transition-colors hover:text-ink md:block"
          >
            Results
          </Link>
          <ThemeToggle />
          <Link
            href="/dashboard"
            aria-current={active === "monitor" ? "page" : undefined}
            className="rounded-control bg-accent px-3.5 py-2 text-[13px] font-medium text-accent-ink transition-colors hover:bg-accent-hover active:translate-y-px"
          >
            Open the monitor
          </Link>
        </nav>
      </div>
    </header>
  );
}

/** A single geometric mark, the one case the taste rules allow hand-drawn SVG:
 *  a shield notch, two paths, no illustration. */
function ShieldMark() {
  return (
    <svg width="20" height="22" viewBox="0 0 20 22" fill="none" aria-hidden>
      <path
        d="M10 1.2 18.2 4v7.1c0 4.6-3.3 8.3-8.2 9.7-4.9-1.4-8.2-5.1-8.2-9.7V4Z"
        stroke="var(--accent)"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="M6.4 10.8 9.1 13.6 13.8 8.2" stroke="var(--accent)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
