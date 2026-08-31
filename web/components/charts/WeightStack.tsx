"use client";

import { useRef, useState } from "react";

/**
 * Per-round aggregation weight, stacked to 1.0.
 *
 * This is the chart that shows a defense actually doing something: under FedAvg
 * every bar is five near-equal bands forever, and under reputation the bands
 * move. A rejected client contributes a zero-height segment, which is the
 * honest rendering of "it was in the round and got no weight".
 *
 * Segments carry a 2px surface gap so adjacent fills never touch.
 */

export type StackRow = { round: number; parts: { id: string; label: string; value: number; color: string }[] };

const W = 780;
const H = 220;
const PAD = { top: 12, right: 12, bottom: 32, left: 48 };

export function WeightStack({ rows }: { rows: StackRow[] }) {
  const ref = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);

  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const slot = plotW / Math.max(rows.length, 1);
  const barW = Math.max(4, slot - 3);

  const hovered = hover === null ? null : rows.find((r) => r.round === hover);

  function onMove(e: React.PointerEvent<SVGSVGElement>) {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect || rows.length === 0) return;
    const px = ((e.clientX - rect.left) / rect.width) * W - PAD.left;
    const idx = Math.floor(px / slot);
    setHover(idx >= 0 && idx < rows.length ? rows[idx].round : null);
  }

  const xTickEvery = Math.max(1, Math.round(rows.length / 8));

  return (
    <div className="relative w-full">
      <svg
        ref={ref}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-auto touch-none"
        role="img"
        aria-label="Aggregation weight per client, stacked to one, by round"
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
      >
        {[0, 0.25, 0.5, 0.75, 1].map((t) => (
          <g key={t}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={PAD.top + (1 - t) * plotH}
              y2={PAD.top + (1 - t) * plotH}
              stroke="var(--grid)"
              strokeWidth={1}
            />
            <text
              x={PAD.left - 10}
              y={PAD.top + (1 - t) * plotH}
              textAnchor="end"
              dominantBaseline="middle"
              className="tnum"
              fill="var(--ink-muted)"
              fontSize={11}
            >
              {t.toFixed(2)}
            </text>
          </g>
        ))}

        {rows.map((row, i) => {
          let acc = 0;
          const x = PAD.left + i * slot + (slot - barW) / 2;
          return (
            <g key={row.round} opacity={hover === null || hover === row.round ? 1 : 0.45}>
              {row.parts.map((p) => {
                const h = p.value * plotH;
                const y = PAD.top + plotH - acc - h;
                acc += h;
                if (h <= 0.5) return null;
                return (
                  <rect
                    key={p.id}
                    x={x}
                    y={y}
                    width={barW}
                    height={Math.max(0, h - 2)}
                    rx={1.5}
                    fill={p.color}
                  />
                );
              })}
            </g>
          );
        })}

        {rows.map((row, i) =>
          i % xTickEvery === 0 || i === rows.length - 1 ? (
            <text
              key={`t-${row.round}`}
              x={PAD.left + i * slot + slot / 2}
              y={H - PAD.bottom + 18}
              textAnchor="middle"
              className="tnum"
              fill="var(--ink-muted)"
              fontSize={11}
            >
              {row.round}
            </text>
          ) : null,
        )}
        <text
          x={PAD.left + plotW / 2}
          y={H - 2}
          textAnchor="middle"
          fill="var(--ink-muted)"
          fontSize={11}
        >
          Round
        </text>
      </svg>

      {hovered && (
        <div className="pointer-events-none absolute right-3 top-2 rounded-[10px] border border-hairline bg-surface/95 px-3 py-2 shadow-lg">
          <div className="mb-1 text-[11px] text-ink-muted">Round {hovered.round}</div>
          <ul className="space-y-1">
            {hovered.parts.map((p) => (
              <li key={p.id} className="flex items-center gap-2 text-[12px] text-ink-2">
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ background: p.color }}
                />
                <span className="mr-2">{p.label}</span>
                <span className="tnum ml-auto font-medium text-ink">{p.value.toFixed(3)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
