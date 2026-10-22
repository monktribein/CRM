"use client";

import { useState } from "react";
import { Check, ChevronsUpDown, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { UserAvatar } from "@/components/common/user-avatar";
import { useFieldControl } from "@/components/ui/field-context";
import type { UserRef } from "@/lib/types";
import { cn } from "@/lib/utils";

export function AssigneePicker({
  options,
  value,
  onChange,
  loading,
  id,
  invalid,
  describedBy,
}: {
  options: UserRef[];
  value: string[];
  onChange: (ids: string[]) => void;
  loading?: boolean;
  id?: string;
  invalid?: boolean;
  describedBy?: string;
}) {
  const [open, setOpen] = useState(false);
  const field = useFieldControl();
  const selected = options.filter((o) => value.includes(o.id));
  const toggle = (uid: string) => onChange(value.includes(uid) ? value.filter((v) => v !== uid) : [...value, uid]);

  return (
    <div className="space-y-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id={id ?? field?.id}
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            aria-invalid={invalid || field?.["aria-invalid"] || undefined}
            aria-describedby={describedBy ?? field?.["aria-describedby"]}
            className="h-9 w-full justify-between font-normal"
          >
            <span className={cn("truncate", !selected.length && "text-muted-foreground")}>
              {loading ? "Loading employees…" : selected.length ? `${selected.length} employee${selected.length > 1 ? "s" : ""} selected` : "Select employees"}
            </span>
            <ChevronsUpDown className="text-muted-foreground" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-(--radix-popover-trigger-width) p-0" align="start">
          <Command>
            <CommandInput placeholder="Search employees…" />
            <CommandList>
              <CommandEmpty>No permitted employees match.</CommandEmpty>
              <CommandGroup>
                {options.map((o) => {
                  const checked = value.includes(o.id);
                  return (
                    <CommandItem key={o.id} value={`${o.name} ${o.email}`} onSelect={() => toggle(o.id)} aria-selected={checked}>
                      <UserAvatar user={o} size="xs" />
                      <span className="flex-1 truncate">{o.name}</span>
                      <span className="truncate text-xs text-muted-foreground">{o.email}</span>
                      <Check className={cn("ml-1", checked ? "opacity-100" : "opacity-0")} />
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {selected.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="Selected assignees">
          {selected.map((u) => (
            <li key={u.id} className="flex items-center gap-1.5 rounded-full border bg-muted/50 py-0.5 pr-1 pl-0.5 text-xs">
              <UserAvatar user={u} size="xs" />
              {u.name}
              <button
                type="button"
                onClick={() => toggle(u.id)}
                className="rounded-full p-0.5 text-muted-foreground hover:bg-background hover:text-foreground"
                aria-label={`Remove ${u.name}`}
              >
                <X className="size-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
