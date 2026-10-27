"use client";

import { useId, useMemo, useRef, useState } from "react";
import { Table, ChartLineUp } from "@phosphor-icons/react";

export type LineSeries = {
  id: string;
  label: string;
  color: string;
  points: { x: number; y: number | null }[];
  dashed?: boolean;
};

interface HighPrecisionLineChartProps {
  series: LineSeries[];
  yDomain?: [number, number];
  yTicks?: number[];
  xLabel?: string;
  yLabel?: string;
  formatY?: (v: number) => string;
  height?: number;
  directLabels?: boolean;
  thresholdLine?: {
    value: number;
    label: string;
    color?: string;
  };
}

const W = 800;
const PAD = { top: 24, right: 110, bottom: 40, left: 56 };

function niceTicks(min: number, max: number, count = 5): number[] {
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

export function HighPrecisionLineChart({
  series,
  yDomain,
  yTicks,
  xLabel = "Round",
  formatY = (v) => v.toFixed(3),
  height = 320,
  directLabels = true,
  thresholdLine,
}: HighPrecisionLineChartProps) {
  const uid = useId().replace(/:/g, "");
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoverX, setHoverX] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);

  const H = height;
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  // X range
  const allX = useMemo(
    () => Array.from(new Set(series.flatMap((s) => s.points.map((p) => p.x)))).sort((a, b) => a - b),
    [series]
  );
  const minX = allX[0] ?? 1;
  const maxX = allX[allX.length - 1] ?? 1;

  // Y range
  const validY = useMemo(
    () =>
      series
        .flatMap((s) => s.points.map((p) => p.y))
        .filter((y): y is number => y !== null && Number.isFinite(y)),
    [series]
  );

  const [minY, maxY] = useMemo(() => {
    if (yDomain) return yDomain;
    if (validY.length === 0) return [0, 1];
    let min = Math.min(...validY);
    let max = Math.max(...validY);
    if (thresholdLine) {
      min = Math.min(min, thresholdLine.value);
      max = Math.max(max, thresholdLine.value);
    }
    const pad = (max - min) * 0.08 || 0.05;
    return [Math.max(0, min - pad), max + pad];
  }, [yDomain, validY, thresholdLine]);

  const ticksY = useMemo(() => yTicks ?? niceTicks(minY, maxY, 5), [yTicks, minY, maxY]);

  // Generate SVG path strings
  const paths = useMemo(() => {
    const scaleX = (x: number) => {
      if (maxX === minX) return PAD.left + plotW / 2;
      return PAD.left + ((x - minX) / (maxX - minX)) * plotW;
    };

    const scaleY = (y: number) => {
      if (maxY === minY) return PAD.top + plotH / 2;
      return PAD.top + (1 - (y - minY) / (maxY - minY)) * plotH;
    };

    return series.map((s) => {
      let d = "";
      let inGap = true;
      for (const p of s.points) {
        if (p.y === null || !Number.isFinite(p.y)) {
          inGap = true;
          continue;
        }
        const px = scaleX(p.x);
        const py = scaleY(p.y);
        if (inGap) {
          d += `M ${px} ${py} `;
          inGap = false;
        } else {
          d += `L ${px} ${py} `;
        }
      }
      return { ...s, d };
    });
  }, [series, minX, maxX, minY, maxY, plotW, plotH]);

  const scaleX = (x: number) => {
    if (maxX === minX) return PAD.left + plotW / 2;
    return PAD.left + ((x - minX) / (maxX - minX)) * plotW;
  };

  const scaleY = (y: number) => {
    if (maxY === minY) return PAD.top + plotH / 2;
    return PAD.top + (1 - (y - minY) / (maxY - minY)) * plotH;
  };

  // Hover position lookup
  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!svgRef.current || allX.length === 0) return;
    const rect = svgRef.current.getBoundingClientRect();
    const cursorX = ((e.clientX - rect.left) / rect.width) * W;
    let closest = allX[0];
    let minDist = Infinity;
    for (const x of allX) {
      const dist = Math.abs(scaleX(x) - cursorX);
      if (dist < minDist) {
        minDist = dist;
        closest = x;
      }
    }
    setHoverX(closest);
  };

  const activePoints = useMemo(() => {
    if (hoverX === null) return [];
    return series
      .map((s) => {
        const pt = s.points.find((p) => p.x === hoverX);
        return {
          id: s.id,
          label: s.label,
          color: s.color,
          value: pt?.y ?? null,
        };
      })
      .filter((p) => p.value !== null);
  }, [hoverX, series]);

  return (
    <div className="w-full flex flex-col space-y-3">
      {/* Controls Bar */}
      <div className="flex items-center justify-between gap-4">
        {/* Series Legends */}
        <div className="flex flex-wrap items-center gap-3">
          {series.map((s) => (
            <div key={s.id} className="flex items-center gap-1.5 text-[12px] text-[var(--ink-secondary)]">
              <span
                className="h-2.5 w-2.5 rounded-full shrink-0"
                style={{ backgroundColor: s.color }}
              />
              <span className="font-medium">{s.label}</span>
            </div>
          ))}
          {thresholdLine && (
            <div className="flex items-center gap-1.5 text-[12px] text-[var(--ink-muted)]">
              <span
                className="h-0.5 w-3 border-t-2 border-dashed shrink-0"
                style={{ borderColor: thresholdLine.color || "var(--status-critical)" }}
              />
              <span>{thresholdLine.label}</span>
            </div>
          )}
        </div>

        {/* View Table Switcher */}
        <button
          type="button"
          onClick={() => setShowTable(!showTable)}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[12px] text-[var(--ink-secondary)] hover:text-[var(--ink-primary)] hover:bg-[var(--glass-subtle)] border border-[var(--glass-border)] transition-colors cursor-pointer"
        >
          {showTable ? <ChartLineUp size={14} weight="bold" /> : <Table size={14} weight="bold" />}
          <span>{showTable ? "Chart View" : "Table View"}</span>
        </button>
      </div>

      {showTable ? (
        /* Tabular Data View */
        <div className="overflow-x-auto rounded-xl border border-[var(--glass-border)] bg-[var(--glass-subtle)] max-h-[320px]">
          <table className="w-full text-left text-[12.5px] border-collapse">
            <thead className="sticky top-0 bg-[var(--glass-elevated)] border-b border-[var(--glass-border)] text-[var(--ink-muted)] font-mono text-[11px] uppercase">
              <tr>
                <th className="px-4 py-2.5">{xLabel}</th>
                {series.map((s) => (
                  <th key={s.id} className="px-4 py-2.5 text-right font-medium" style={{ color: s.color }}>
                    {s.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--glass-border)] font-mono">
              {allX.map((x) => (
                <tr key={x} className="hover:bg-[var(--glass-elevated)]/50 transition-colors">
                  <td className="px-4 py-2 text-[var(--ink-primary)] font-semibold">{x}</td>
                  {series.map((s) => {
                    const pt = s.points.find((p) => p.x === x);
                    return (
                      <td key={s.id} className="px-4 py-2 text-right tnum text-[var(--ink-secondary)]">
                        {pt?.y !== null && pt?.y !== undefined ? formatY(pt.y) : "—"}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        /* Interactive SVG Chart View */
        <div className="relative w-full overflow-hidden rounded-xl border border-[var(--glass-border)] bg-[var(--glass-subtle)] p-2">
          <svg
            ref={svgRef}
            viewBox={`0 0 ${W} ${H}`}
            className="w-full h-auto select-none"
            onMouseMove={handleMouseMove}
            onMouseLeave={() => setHoverX(null)}
          >
            <defs>
              {series.map((s) => (
                <linearGradient key={`grad-${s.id}-${uid}`} id={`grad-${s.id}-${uid}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={s.color} stopOpacity="0.25" />
                  <stop offset="100%" stopColor={s.color} stopOpacity="0.0" />
                </linearGradient>
              ))}
            </defs>

            {/* Horizontal Grid lines & Y Ticks */}
            {ticksY.map((t) => {
              const y = scaleY(t);
              if (y < PAD.top - 2 || y > H - PAD.bottom + 2) return null;
              return (
                <g key={`y-tick-${t}`}>
                  <line
                    x1={PAD.left}
                    y1={y}
                    x2={W - PAD.right}
                    y2={y}
                    stroke="var(--chart-grid)"
                    strokeWidth="1"
                    strokeDasharray="3 3"
                  />
                  <text
                    x={PAD.left - 8}
                    y={y + 3.5}
                    textAnchor="end"
                    fill="var(--ink-muted)"
                    fontSize="10.5"
                    fontFamily="monospace"
                  >
                    {formatY(t)}
                  </text>
                </g>
              );
            })}

            {/* Threshold line if configured */}
            {thresholdLine && (
              <g>
                <line
                  x1={PAD.left}
                  y1={scaleY(thresholdLine.value)}
                  x2={W - PAD.right}
                  y2={scaleY(thresholdLine.value)}
                  stroke={thresholdLine.color || "var(--status-critical)"}
                  strokeWidth="1.5"
                  strokeDasharray="4 4"
                />
              </g>
            )}

            {/* Vertical X Axis labels */}
            {allX
              .filter((_, i) => i % Math.ceil(allX.length / 8) === 0 || i === allX.length - 1)
              .map((x) => {
                const px = scaleX(x);
                return (
                  <g key={`x-tick-${x}`}>
                    <line
                      x1={px}
                      y1={H - PAD.bottom}
                      x2={px}
                      y2={H - PAD.bottom + 5}
                      stroke="var(--glass-border)"
                      strokeWidth="1"
                    />
                    <text
                      x={px}
                      y={H - PAD.bottom + 18}
                      textAnchor="middle"
                      fill="var(--ink-muted)"
                      fontSize="11"
                      fontFamily="monospace"
                    >
                      {x}
                    </text>
                  </g>
                );
              })}

            {/* Data Lines */}
            {paths.map((s) => (
              <g key={`path-${s.id}`}>
                <path
                  d={s.d}
                  fill="none"
                  stroke={s.color}
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeDasharray={s.dashed ? "6 4" : undefined}
                />

                {/* Direct Label at End of Line */}
                {directLabels && s.points.length > 0 && (
                  (() => {
                    const lastPt = [...s.points].reverse().find((p) => p.y !== null);
                    if (!lastPt || lastPt.y === null) return null;
                    return (
                      <text
                        x={scaleX(lastPt.x) + 8}
                        y={scaleY(lastPt.y) + 3.5}
                        fill={s.color}
                        fontSize="11"
                        fontWeight="600"
                        fontFamily="monospace"
                      >
                        {formatY(lastPt.y)}
                      </text>
                    );
                  })()
                )}
              </g>
            ))}

            {/* Hover Crosshair & Data Marker Dots */}
            {hoverX !== null && (
              <g>
                <line
                  x1={scaleX(hoverX)}
                  y1={PAD.top}
                  x2={scaleX(hoverX)}
                  y2={H - PAD.bottom}
                  stroke="var(--chart-crosshair)"
                  strokeWidth="1.2"
                  strokeDasharray="3 3"
                />

                {series.map((s) => {
                  const pt = s.points.find((p) => p.x === hoverX);
                  if (!pt || pt.y === null || !Number.isFinite(pt.y)) return null;
                  return (
                    <circle
                      key={`hover-dot-${s.id}`}
                      cx={scaleX(hoverX)}
                      cy={scaleY(pt.y)}
                      r="4.5"
                      fill={s.color}
                      stroke="var(--canvas-bg)"
                      strokeWidth="2"
                      className="transition-transform duration-100"
                    />
                  );
                })}
              </g>
            )}
          </svg>

          {/* Floating Tooltip Card */}
          {hoverX !== null && activePoints.length > 0 && (
            <div
              className="absolute top-4 left-16 z-20 pointer-events-none glass-card-elevated p-3 rounded-xl border border-[var(--glass-border)] shadow-xl animate-in fade-in duration-150 max-w-xs"
            >
              <div className="flex items-center justify-between gap-4 pb-1.5 border-b border-[var(--glass-border)]">
                <span className="text-[11px] font-mono font-semibold text-[var(--ink-secondary)]">
                  {xLabel} {hoverX}
                </span>
              </div>
              <div className="mt-2 space-y-1.5">
                {activePoints.map((p) => (
                  <div key={p.id} className="flex items-center justify-between gap-4 text-[12px]">
                    <span className="flex items-center gap-1.5 text-[var(--ink-secondary)]">
                      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: p.color }} />
                      <span className="truncate max-w-[120px]">{p.label}</span>
                    </span>
                    <span className="font-mono font-semibold tnum text-[var(--ink-primary)]">
                      {p.value !== null ? formatY(p.value) : "—"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
