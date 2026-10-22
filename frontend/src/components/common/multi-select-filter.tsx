"use client";

import { Check, ChevronDown, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export interface FilterOption<V extends string> {
  value: V;
  label: string;
  icon?: LucideIcon;
}

export function MultiSelectFilter<V extends string>({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: FilterOption<V>[];
  selected: V[];
  onChange: (values: V[]) => void;
}) {
  const toggle = (v: V) => onChange(selected.includes(v) ? selected.filter((s) => s !== v) : [...selected, v]);
  const summary =
    selected.length === 0
      ? null
      : selected.length === 1
        ? options.find((o) => o.value === selected[0])?.label
        : `${selected.length} selected`;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className={cn("gap-1.5", selected.length > 0 && "border-primary/40 bg-accent/40")}>
          {label}
          {summary && (
            <>
              <span className="text-muted-foreground" aria-hidden="true">·</span>
              <span className="font-medium text-primary">{summary}</span>
            </>
          )}
          <ChevronDown className="text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-52 p-1">
        <div role="group" aria-label={label}>
          {options.map((o) => {
            const checked = selected.includes(o.value);
            const Icon = o.icon;
            return (
              <button
                key={o.value}
                type="button"
                role="checkbox"
                aria-checked={checked}
                onClick={() => toggle(o.value)}
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-muted focus-visible:bg-muted"
              >
                <span
                  className={cn(
                    "flex size-4 items-center justify-center rounded-[4px] border",
                    checked ? "border-primary bg-primary text-white" : "border-input"
                  )}
                  aria-hidden="true"
                >
                  {checked && <Check className="size-3" />}
                </span>
                {Icon && <Icon className="size-4 text-muted-foreground" aria-hidden="true" />}
                {o.label}
              </button>
            );
          })}
        </div>
        {selected.length > 0 && (
          <button
            type="button"
            onClick={() => onChange([])}
            className="mt-1 w-full rounded-sm border-t px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-muted"
          >
            Clear selection
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
}
