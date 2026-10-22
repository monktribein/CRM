"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { FolderKanban, ListChecks, Loader2, Search, User } from "lucide-react";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { StatusBadge } from "@/components/tasks/task-badges";
import { useDebounce } from "@/hooks/use-debounce";
import { getErrorMessage } from "@/lib/api/client";
import { searchApi } from "@/lib/api/services";
import { qk } from "@/lib/query-keys";

export function SearchTrigger({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label="Search tasks, people and projects"
      className="flex h-8 w-8 shrink-0 items-center justify-center gap-2 rounded-md border sm:w-full sm:max-w-sm sm:justify-start bg-muted/50 px-2.5 text-sm text-muted-foreground outline-none transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <Search className="size-4" aria-hidden="true" />
      <span className="hidden flex-1 truncate text-left sm:inline">Search tasks, people, projects…</span>
      <kbd className="hidden rounded border bg-background px-1.5 text-[10px] font-medium sm:inline">Ctrl K</kbd>
    </button>
  );
}

export function GlobalSearch({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  const [term, setTerm] = useState("");
  const debounced = useDebounce(term.trim(), 250);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        onOpenChange(!open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  const { data, isFetching, error } = useQuery({
    queryKey: qk.search(debounced),
    queryFn: ({ signal }) => searchApi.search(debounced, signal),
    enabled: open && debounced.length >= 2,
    staleTime: 10_000,
  });

  const go = (href: string) => {
    onOpenChange(false);
    setTerm("");
    router.push(href);
  };

  const hasResults = !!data && (data.tasks.length || data.employees.length || data.projects.length);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="top-[20%] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-xl" showCloseButton={false}>
        <DialogTitle className="sr-only">Search</DialogTitle>
        <DialogDescription className="sr-only">Search tasks, employees and projects</DialogDescription>
        <Command shouldFilter={false}>
          <CommandInput value={term} onValueChange={setTerm} placeholder="Search by task ID, title, person or project…" />
          <CommandList className="max-h-96">
            {debounced.length < 2 ? (
              <p className="px-4 py-6 text-center text-sm text-muted-foreground">Type at least 2 characters to search.</p>
            ) : isFetching && !data ? (
              <p className="flex items-center justify-center gap-2 px-4 py-6 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Searching…
              </p>
            ) : error ? (
              <p className="px-4 py-6 text-center text-sm text-red-600">{getErrorMessage(error)}</p>
            ) : !hasResults ? (
              <CommandEmpty>No results for “{debounced}”.</CommandEmpty>
            ) : (
              <>
                {!!data?.tasks.length && (
                  <CommandGroup heading="Tasks">
                    {data.tasks.map((t) => (
                      <CommandItem key={t.id} value={`task-${t.id}`} onSelect={() => go(`/tasks/${t.id}`)}>
                        <ListChecks className="text-muted-foreground" />
                        <span className="font-mono text-xs text-muted-foreground">{t.key}</span>
                        <span className="flex-1 truncate">{t.title}</span>
                        <StatusBadge status={t.status} />
                      </CommandItem>
                    ))}
                  </CommandGroup>
                )}
                {!!data?.employees.length && (
                  <CommandGroup heading="People">
                    {data.employees.map((e) => (
                      <CommandItem key={e.id} value={`emp-${e.id}`} onSelect={() => go(`/employees?search=${encodeURIComponent(e.email)}`)}>
                        <User className="text-muted-foreground" />
                        <span className="flex-1 truncate">{e.name}</span>
                        <span className="text-xs text-muted-foreground">{e.departmentName}</span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                )}
                {!!data?.projects.length && (
                  <CommandGroup heading="Projects">
                    {data.projects.map((p) => (
                      <CommandItem key={p.id} value={`prj-${p.id}`} onSelect={() => go(`/my-tasks?projectId=${p.id}`)}>
                        <FolderKanban className="text-muted-foreground" />
                        <span className="font-mono text-xs text-muted-foreground">{p.key}</span>
                        <span className="flex-1 truncate">{p.name}</span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                )}
              </>
            )}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
