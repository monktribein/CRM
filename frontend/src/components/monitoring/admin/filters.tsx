"use client";

import { Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useDepartments } from "@/hooks/use-lookups";

export const ALL = "__all__";

/** Calendar-day range; days are interpreted in the organisation timezone by the API. */
export function DateRangeFilter({
  from,
  to,
  onChange,
  timeZone,
}: {
  from?: string;
  to?: string;
  onChange: (range: { from?: string; to?: string }) => void;
  timeZone: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={`Date range (${timeZone})`}>
      <Input type="date" value={from ?? ""} max={to} onChange={(e) => onChange({ from: e.target.value || undefined, to })} className="h-8 w-[9.5rem]" aria-label="From date" />
      <span className="text-xs text-muted-foreground" aria-hidden="true">–</span>
      <Input type="date" value={to ?? ""} min={from} onChange={(e) => onChange({ from, to: e.target.value || undefined })} className="h-8 w-[9.5rem]" aria-label="To date" />
      {(from || to) && (
        <Button variant="ghost" size="icon-sm" onClick={() => onChange({})} aria-label="Clear dates"><X /></Button>
      )}
    </div>
  );
}

export function SearchFilter({ value, onChange, placeholder, label }: { value: string; onChange: (v: string) => void; placeholder: string; label: string }) {
  return (
    <div className="relative w-full sm:w-64">
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
      <Input type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="h-8 pl-8" aria-label={label} />
    </div>
  );
}

export function DepartmentFilter({ value, onChange }: { value?: string; onChange: (v: string | undefined) => void }) {
  const { data } = useDepartments();
  return (
    <Select value={value ?? ALL} onValueChange={(v) => onChange(v === ALL ? undefined : v)}>
      <SelectTrigger size="sm" className="w-44" aria-label="Department"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>All departments</SelectItem>
        {data?.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

export function EnumFilter<T extends string>({
  value,
  onChange,
  labels,
  allLabel,
  ariaLabel,
}: {
  value?: T;
  onChange: (v: T | undefined) => void;
  labels: Record<T, string>;
  allLabel: string;
  ariaLabel: string;
}) {
  return (
    <Select value={value ?? ALL} onValueChange={(v) => onChange(v === ALL ? undefined : (v as T))}>
      <SelectTrigger size="sm" className="w-40" aria-label={ariaLabel}><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{allLabel}</SelectItem>
        {(Object.entries(labels) as [T, string][]).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}
