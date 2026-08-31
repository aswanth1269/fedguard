"use client";

import { useId, useMemo, useRef, useState } from "react";

/**
 * Multi-series line chart, hand-rolled so the mark specs are exact.
 *
 * Deliberate choices:
 *  - ONE y axis. PR-AUC, ASR and recall are all rates on [0, 1], so they share a
 *    scale honestly. Two measures of different scale would get two charts, never
 *    a second axis.
 *  - 2px strokes, recessive hairline grid, markers on hover only.
 *  - A legend is always present for two or more series, and four or fewer are
 *    ALSO direct-labelled at the line end, so identity never rests on colour.
 *  - Crosshair plus tooltip by default. An SVG chart in a browser is an
 *    interactive chart; shipping it inert throws away the medium.
 */

export type Series = {
  id: string;
  label: string;
  color: string;
  /** A null y is a gap, not a zero. ASR is null for runs with no trigger. */
  points: { x: number; y: number | null }[];
  dashed?: boolean;
};

type Props = {
  series: Series[];
  yDomain?: [number, number];
  yTicks?: number[];
  xLabel?: string;
  yLabel?: string;
  formatY?: (v: number) => string;
  height?: number;
  directLabels?: boolean;
};

const W = 780;
const PAD = { top: 18, right: 104, bottom: 34, left: 48 };

function niceTicks(min: number, max: number, count = 4): number[] {
  const span = max - min || 1;
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? mag * 10;
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) {
    out.push(Number(v.toFixed(10)));
  }
  return out;
}

export function LineChart({
  series,
  yDomain,
  yTicks,
  xLabel = "Round",
  yLabel,
  formatY = (v) => v.toFixed(2),
  height = 300,
  directLabels = true,
}: Props) {
  const uid = useId().replace(/:/g, "");
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoverX, setHoverX] = useState<number | null>(null);

  const H = height;
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const { xs, yMin, yMax } = useMemo(() => {
    const allX = series.flatMap((s) => s.points.map((p) => p.x));
    const allY = series.flatMap((s) =>
      s.points.map((p) => p.y).filter((y): y is number => y !== null),
    );
    const lo = yDomain ? yDomain[0] : Math.min(...allY);
    const hi = yDomain ? yDomain[1] : Math.max(...allY);
    const padY = yDomain ? 0 : (hi - lo) * 0.12 || 0.05;
    return {
      xs: Array.from(new Set(allX)).sort((a, b) => a - b),
      yMin: yDomain ? lo : lo - padY,
      yMax: yDomain ? hi : hi + padY,
    };
  }, [series, yDomain]);

  const xMin = xs[0] ?? 0;
  const xMax = xs[xs.length - 1] ?? 1;

  const sx = (x: number) => PAD.left + ((x - xMin) / (xMax - xMin || 1)) * plotW;
  const sy = (y: number) => PAD.top + (1 - (y - yMin) / (yMax - yMin || 1)) * plotH;

  const ticks = yTicks ?? niceTicks(yMin, yMax);
  const xTickEvery = Math.max(1, Math.round(xs.length / 8));
  const xTicks = xs.filter((_, i) => i % xTickEvery === 0 || i === xs.length - 1);

  const paths = series.map((s) => {
    let d = "";
    let pen = false;
    for (const p of s.points) {
      if (p.y === null) {
        pen = false;
        continue;
      }
      d += `${pen ? "L" : "M"}${sx(p.x).toFixed(2)} ${sy(p.y).toFixed(2)}`;
      pen = true;
    }
    return { ...s, d };
  });

  /* End-of-line labels, pushed apart when series converge. Two runs that land
     within 0.0005 of each other is the whole point of this chart, so their
     labels would otherwise sit on top of one another. */
  const endLabels = (() => {
    const raw = paths
      .map((s) => {
        const last = [...s.points].reverse().find((p) => p.y !== null);
        return last && last.y !== null
          ? { id: s.id, label: s.label, color: s.color, y: sy(last.y), labelY: sy(last.y) }
          : null;
      })
      .filter((v): v is NonNullable<typeof v> => v !== null)
      .sort((a, b) => a.y - b.y);

    const MIN_GAP = 15;
    for (let i = 1; i < raw.length; i++) {
      const gap = raw[i].labelY - raw[i - 1].labelY;
      if (gap < MIN_GAP) raw[i].labelY = raw[i - 1].labelY + MIN_GAP;
    }
    // Keep the stack inside the plot if pushing ran it off the bottom.
    const overflow = (raw.at(-1)?.labelY ?? 0) - (PAD.top + plotH);
    if (overflow > 0) raw.forEach((l) => (l.labelY -= overflow));
    return raw;
  })();

  function onMove(e: React.PointerEvent<SVGSVGElement>) {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || xs.length === 0) return;
    const px = ((e.clientX - rect.left) / rect.width) * W;
    if (px < PAD.left - 8 || px > W - PAD.right + 8) {
      setHoverX(null);
      return;
    }
    const value = xMin + ((px - PAD.left) / (plotW || 1)) * (xMax - xMin);
    const nearest = xs.reduce((a, b) => (Math.abs(b - value) < Math.abs(a - value) ? b : a), xs[0]);
    setHoverX(nearest);
  }

  const hovered =
    hoverX === null
      ? null
      : series.map((s) => ({ ...s, y: s.points.find((p) => p.x === hoverX)?.y ?? null }));

  const tooltipLeft = hoverX !== null && sx(hoverX) > W * 0.62;

  return (
    <div className="relative w-full">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-auto touch-none"
        role="img"
        aria-label={`${yLabel ?? "value"} by ${xLabel.toLowerCase()}, ${series.length} series`}
        onPointerMove={onMove}
        onPointerLeave={() => setHoverX(null)}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={sy(t)}
              y2={sy(t)}
              stroke="var(--grid)"
              strokeWidth={1}
            />
            <text
              x={PAD.left - 10}
              y={sy(t)}
              textAnchor="end"
              dominantBaseline="middle"
              className="tnum"
              fill="var(--ink-muted)"
              fontSize={11}
            >
              {formatY(t)}
            </text>
          </g>
        ))}

        <line
          x1={PAD.left}
          x2={W - PAD.right}
          y1={PAD.top + plotH}
          y2={PAD.top + plotH}
          stroke="var(--baseline)"
          strokeWidth={1}
        />

        {xTicks.map((t) => (
          <text
            key={t}
            x={sx(t)}
            y={H - PAD.bottom + 18}
            textAnchor="middle"
            className="tnum"
            fill="var(--ink-muted)"
            fontSize={11}
          >
            {t}
          </text>
        ))}
        <text
          x={PAD.left + plotW / 2}
          y={H - 2}
          textAnchor="middle"
          fill="var(--ink-muted)"
          fontSize={11}
        >
          {xLabel}
        </text>

        {hoverX !== null && (
          <line
            x1={sx(hoverX)}
            x2={sx(hoverX)}
            y1={PAD.top}
            y2={PAD.top + plotH}
            stroke="var(--baseline)"
            strokeWidth={1}
            strokeDasharray="3 3"
          />
        )}

        {paths.map((s) => (
          <path
            key={s.id}
            d={s.d}
            fill="none"
            stroke={s.color}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray={s.dashed ? "6 4" : undefined}
          />
        ))}

        {hovered?.map((s) =>
          s.y === null || hoverX === null ? null : (
            <circle
              key={`${uid}-${s.id}`}
              cx={sx(hoverX)}
              cy={sy(s.y)}
              r={4.5}
              fill={s.color}
              stroke="var(--surface)"
              strokeWidth={2}
            />
          ),
        )}

        {directLabels &&
          series.length <= 4 &&
          endLabels.map((l) => (
            <g key={`lbl-${l.id}`} transform={`translate(${W - PAD.right + 10}, ${l.labelY})`}>
              {/* Leader line, drawn only when de-collision moved the label off
                  its own data point, so the reader can still trace it back. */}
              {Math.abs(l.labelY - l.y) > 1.5 && (
                <path
                  d={`M-6 ${(l.y - l.labelY).toFixed(2)} L-2 0`}
                  stroke={l.color}
                  strokeWidth={1}
                  fill="none"
                />
              )}
              <circle cx={0} cy={0} r={3} fill={l.color} />
              <text x={8} y={0} dominantBaseline="middle" fill="var(--ink-2)" fontSize={11}>
                {l.label}
              </text>
            </g>
          ))}
      </svg>

      {hovered && hoverX !== null && (
        <div
          className="pointer-events-none absolute top-2 rounded-[10px] border border-hairline bg-surface/95 px-3 py-2 shadow-lg"
          style={tooltipLeft ? { left: "2%" } : { right: "2%" }}
        >
          <div className="mb-1 text-[11px] text-ink-muted">
            {xLabel} {hoverX}
          </div>
          <ul className="space-y-1">
            {hovered.map((s) => (
              <li key={s.id} className="flex items-center gap-2 text-[12px] text-ink-2">
                <span
                  className="inline-block h-2 w-2 shrink-0 rounded-full"
                  style={{ background: s.color }}
                />
                <span className="mr-2">{s.label}</span>
                <span className="tnum ml-auto font-medium text-ink">
                  {s.y === null ? "n/a" : formatY(s.y)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
