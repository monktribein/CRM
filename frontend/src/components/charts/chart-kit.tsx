"use client";

import { useState } from "react";
import { BarChart3, Table2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * Categorical series colors, assigned in fixed order (validated for CVD
 * separation, chroma and 3:1 contrast on white). Status colors are separate
 * and reserved for task state.
 */
export const SERIES = ["#4f46e5", "#0284c7", "#d97706", "#0d9488"] as const;
export const STATUS_COLORS = {
  good: "#059669",
  warning: "#d97706",
  critical: "#dc2626",
  neutral: "#94a3b8",
} as const;

export const axisProps = {
  tick: { fill: "#64748b", fontSize: 12 },
  tickLine: false,
  axisLine: false,
} as const;

export const gridProps = { stroke: "#e2e8f0", strokeDasharray: "0", vertical: false } as const;

export interface TableColumn<T> {
  key: keyof T & string;
  label: string;
  align?: "left" | "right";
  format?: (value: T[keyof T], row: T) => React.ReactNode;
}

export function ChartCard<T extends object>({
  title,
  description,
  actions,
  loading,
  empty,
  height = 260,
  table,
  className,
  children,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  loading?: boolean;
  empty?: boolean;
  height?: number;
  table?: { rows: T[]; columns: TableColumn<T>[] };
  className?: string;
  children: React.ReactNode;
}) {
  const [asTable, setAsTable] = useState(false);
  return (
    <section className={cn("rounded-lg border bg-card shadow-xs", className)} aria-label={title}>
      <header className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2 px-4 pt-4">
        <div className="min-w-[12rem] flex-1">
          <h2 className="text-sm font-semibold">{title}</h2>
          {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {actions}
          {table && !loading && !empty && (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setAsTable((v) => !v)}
              aria-pressed={asTable}
              aria-label={asTable ? `Show ${title} as chart` : `Show ${title} as table`}
            >
              {asTable ? <BarChart3 /> : <Table2 />}
            </Button>
          )}
        </div>
      </header>
      <div className="p-4 pt-3">
        {loading ? (
          <Skeleton className="w-full" style={{ height }} />
        ) : empty ? (
          <div className="flex items-center justify-center text-sm text-muted-foreground" style={{ height }}>
            No data for this period.
          </div>
        ) : asTable && table ? (
          <div className="overflow-auto" style={{ maxHeight: height }}>
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-card">
                <tr className="border-b text-xs text-muted-foreground">
                  {table.columns.map((c) => (
                    <th key={c.key} scope="col" className={cn("py-2 font-medium", c.align === "right" ? "text-right" : "text-left")}>
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((row, i) => (
                  <tr key={i} className="border-b last:border-0">
                    {table.columns.map((c) => (
                      <td key={c.key} className={cn("py-2 tabular", c.align === "right" && "text-right")}>
                        {c.format ? c.format(row[c.key], row) : String(row[c.key] ?? "")}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={{ height }}>{children}</div>
        )}
      </div>
    </section>
  );
}

interface TooltipPayloadItem {
  name?: string | number;
  value?: number | string;
  color?: string;
  dataKey?: string | number;
}

/** Recharts tooltip content in the app's visual language. */
export function ChartTooltip({
  active,
  payload,
  label,
  valueFormatter = (v) => String(v),
}: {
  active?: boolean;
  payload?: TooltipPayloadItem[];
  label?: string | number;
  valueFormatter?: (v: number | string) => string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border bg-popover px-3 py-2 text-xs shadow-md">
      {label !== undefined && <p className="mb-1 font-medium text-foreground">{label}</p>}
      <ul className="space-y-0.5">
        {payload.map((p) => (
          <li key={String(p.dataKey ?? p.name)} className="flex items-center gap-2">
            <span className="size-2 rounded-sm" style={{ background: p.color }} aria-hidden="true" />
            <span className="text-muted-foreground">{p.name}</span>
            <span className="ml-auto pl-3 font-medium text-foreground tabular">{valueFormatter(p.value ?? 0)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {items.map((i) => (
        <li key={i.label} className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm" style={{ background: i.color }} aria-hidden="true" />
          {i.label}
        </li>
      ))}
    </ul>
  );
}
