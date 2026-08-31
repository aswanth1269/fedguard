import type { ReactNode } from "react";

/**
 * Section reveal. Pure CSS, and a Server Component, which is the point.
 *
 * This started as a Motion `whileInView` wrapper and had to be replaced: the
 * observer initialises after first paint, so content already on screen sat at
 * opacity 0 until the visitor scrolled, and when the JS animation did not run
 * at all the page shipped entire invisible sections. An animation that fails
 * closed on empty content is worse than no animation.
 *
 * Both modes here fail open. `mount` is a plain keyframe, which always runs.
 * `view` is a scroll-linked animation applied only where the browser supports a
 * view timeline, so the element is visible by default and the movement is the
 * enhancement. Both are neutralised by the reduced-motion block in globals.css.
 */
export function Reveal({
  children,
  delay = 0,
  className,
  entry = "view",
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
  entry?: "view" | "mount";
}) {
  const base = entry === "mount" ? "fg-reveal" : "fg-reveal-view";

  return (
    <div
      className={`${base}${className ? ` ${className}` : ""}`}
      style={entry === "mount" && delay ? { animationDelay: `${delay}s` } : undefined}
    >
      {children}
    </div>
  );
}
