"use client";

import { useState, type ReactNode } from "react";
import { ChartLine, Table as TableIcon } from "@phosphor-icons/react";

export type LegendItem = { id: string; label: string; color: string; note?: string };

type Props = {
  title: string;
  /** One line on what the reader should take from the chart. Not decoration. */
  caption?: string;
  legend?: LegendItem[];
  /** Rows for the table view. First column is the row header. */
  table?: { columns: string[]; rows: (string | number)[][] };
  children: ReactNode;
};

/**
 * Chart chrome: title, caption, legend, and a table view.
 *
 * The table is not a nicety. Three light-mode series sit below 3:1 contrast on
 * the light surface, and the data-viz relief rule for that case is visible
 * labels or a table view. This ships both.
 */
export function ChartFrame({ title, caption, legend, table, children }: Props) {
  const [view, setView] = useState<"chart" | "table">("chart");

  return (
    <figure className="rounded-card glass-quiet">
      <figcaption className="flex flex-wrap items-start gap-3 border-b border-hairline px-5 py-4">
        {/* min-width forces the view toggle onto its own row on narrow screens
            instead of squeezing the title into a three-line column. */}
        <div className="min-w-[15rem] flex-1">
          <h3 className="text-[15px] font-medium text-ink">{title}</h3>
          {caption && <p className="mt-1 max-w-[65ch] text-[13px] text-ink-2">{caption}</p>}
        </div>
        {table && (
          <div className="flex shrink-0 rounded-control border border-hairline p-0.5">
            <button
              type="button"
              onClick={() => setView("chart")}
              aria-pressed={view === "chart"}
              className={`flex items-center gap-1.5 rounded-[7px] px-2.5 py-1 text-[12px] transition-colors ${
                view === "chart" ? "bg-surface-2 text-ink" : "text-ink-muted hover:text-ink-2"
              }`}
            >
              <ChartLine size={14} weight="bold" aria-hidden />
              Chart
            </button>
            <button
              type="button"
              onClick={() => setView("table")}
              aria-pressed={view === "table"}
              className={`flex items-center gap-1.5 rounded-[7px] px-2.5 py-1 text-[12px] transition-colors ${
                view === "table" ? "bg-surface-2 text-ink" : "text-ink-muted hover:text-ink-2"
              }`}
            >
              <TableIcon size={14} weight="bold" aria-hidden />
              Table
            </button>
          </div>
        )}
      </figcaption>

      {legend && legend.length > 1 && view === "chart" && (
        <ul className="flex flex-wrap gap-x-5 gap-y-2 px-5 pt-4">
          {legend.map((l) => (
            <li key={l.id} className="flex items-center gap-2 text-[12px] text-ink-2">
              <span
                className="inline-block h-2.5 w-2.5 rounded-full"
                style={{ background: l.color }}
                aria-hidden
              />
              {l.label}
              {l.note && <span className="text-ink-muted">{l.note}</span>}
            </li>
          ))}
        </ul>
      )}

      <div className="px-3 pb-4 pt-3 sm:px-5">
        {view === "chart" ? (
          children
        ) : table ? (
          <div className="max-h-[340px] overflow-auto">
            <table className="w-full border-collapse text-[12px]">
              <thead className="sticky top-0 bg-surface">
                <tr>
                  {table.columns.map((c) => (
                    <th
                      key={c}
                      scope="col"
                      className="border-b border-hairline px-3 py-2 text-left font-medium text-ink-2"
                    >
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((row, i) => (
                  <tr key={i}>
                    {row.map((cell, j) => (
                      <td
                        key={j}
                        className={`px-3 py-1.5 ${j === 0 ? "text-ink-2" : "tnum text-ink"}`}
                      >
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </figure>
  );
}
