"use client";

import {
  formatDueDate,
  fromCasablancaDateInputValue,
  isDueSoon,
  isOverdue,
  toCasablancaDateInputValue,
} from "@/lib/date";
import { CalendarIcon } from "@/components/ui/icons";
import { cn } from "@/lib/cn";

interface DueDateFieldProps {
  value: string | null;
  onChange: (next: string | null) => void;
  readOnly?: boolean;
}

export function DueDateField({ value, onChange, readOnly }: DueDateFieldProps) {
  const overdue = isOverdue(value);
  const soon = isDueSoon(value);
  const toneClass = overdue
    ? "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300"
    : soon
      ? "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300"
      : "text-slate-500 dark:text-slate-400";

  if (readOnly) {
    return (
      <span className={cn("inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium", toneClass)}>
        <CalendarIcon className="h-3.5 w-3.5 shrink-0" />
        {formatDueDate(value)}
      </span>
    );
  }

  return (
    <label className={cn("inline-flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium", toneClass, !overdue && !soon && "hover:bg-slate-100 dark:hover:bg-slate-800")}>
      <CalendarIcon className="h-3.5 w-3.5 shrink-0" />
      <input
        type="date"
        value={toCasablancaDateInputValue(value)}
        onChange={(event) => onChange(fromCasablancaDateInputValue(event.target.value))}
        aria-label="Due date"
        className="min-w-[100px] cursor-pointer bg-transparent text-xs outline-none [color-scheme:light] dark:[color-scheme:dark]"
      />
    </label>
  );
}
