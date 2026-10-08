"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { ChevronDownIcon, RepeatIcon } from "@/components/ui/icons";
import { calendarDateInCasablanca } from "@/lib/casablancaDate";
import { WEEKDAY_LABELS, describeRecurrence } from "@/lib/recurrence";
import { cn } from "@/lib/cn";
import type { RecurrenceFrequency, RecurrenceRule } from "@/types/task";

interface RecurrenceMenuProps {
  value: RecurrenceRule | null;
  dueDate: string | null;
  onChange: (next: RecurrenceRule | null) => void;
  readOnly?: boolean;
}

const FREQUENCY_OPTIONS: { value: RecurrenceFrequency; label: string }[] = [
  { value: "daily", label: "Day" },
  { value: "weekly", label: "Week" },
  { value: "monthly", label: "Month" },
];

function defaultRule(dueDate: string | null): RecurrenceRule {
  const base = dueDate ? new Date(dueDate) : new Date();
  const [year, month, day] = calendarDateInCasablanca(base).split("-").map(Number);
  const calendarDay = new Date(Date.UTC(year, month - 1, day));
  return { frequency: "weekly", interval: 1, daysOfWeek: [calendarDay.getUTCDay()], dayOfMonth: null };
}

export function RecurrenceMenu({ value, dueDate, onChange, readOnly }: RecurrenceMenuProps) {
  const [open, setOpen] = useState(false);
  const [todayCalendarDate] = useState(() => calendarDateInCasablanca(new Date()));
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const left = Math.min(rect.left, window.innerWidth - 300);
    setPosition({ top: rect.bottom + 6, left: Math.max(8, left) });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open) return;
    panelRef.current?.focus();
    function onPointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  function onPanelKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
    }
  }

  const badge = (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium",
        value ? "bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300" : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"
      )}
    >
      <RepeatIcon className="h-3.5 w-3.5 shrink-0" />
      {describeRecurrence(value)}
    </span>
  );

  if (readOnly) return badge;

  function toggleRepeat() {
    onChange(value ? null : defaultRule(dueDate));
  }

  function patchRule(patch: Partial<RecurrenceRule>) {
    if (!value) return;
    onChange({ ...value, ...patch });
  }

  function toggleWeekday(day: number) {
    if (!value) return;
    const next = value.daysOfWeek.includes(day) ? value.daysOfWeek.filter((d) => d !== day) : [...value.daysOfWeek, day].sort((a, b) => a - b);
    patchRule({ daysOfWeek: next });
  }

  return (
    <div className="relative inline-flex">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
      >
        <span className={cn("inline-flex items-center gap-1 rounded-md transition-colors", open && "ring-2 ring-indigo-400")}>
          {badge}
          <ChevronDownIcon className="h-3 w-3 opacity-60" />
        </span>
      </button>

      {open &&
        createPortal(
          <div
            ref={panelRef}
            role="dialog"
            aria-label="Repeat settings"
            tabIndex={-1}
            onKeyDown={onPanelKeyDown}
            style={{ position: "fixed", top: position.top, left: position.left }}
            className="z-[95] w-72 animate-scale-in rounded-lg border border-slate-200 bg-white p-3 shadow-xl focus:outline-none dark:border-slate-700 dark:bg-slate-900"
          >
            <label className="mb-3 flex items-center justify-between text-sm font-medium text-slate-700 dark:text-slate-200">
              Repeat this task
              <input
                type="checkbox"
                checked={value !== null}
                onChange={toggleRepeat}
                className="h-4 w-4 rounded border-slate-300 text-indigo-600 dark:border-slate-600 dark:bg-slate-800"
              />
            </label>

            {value && (
              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-slate-500 dark:text-slate-400">Every</span>
                  <input
                    type="number"
                    min={1}
                    value={value.interval}
                    onChange={(event) => patchRule({ interval: Math.max(1, Number(event.target.value) || 1) })}
                    className="w-14 rounded-md border border-slate-200 px-2 py-1 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                  />
                  <div className="flex items-center gap-1">
                    {FREQUENCY_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => patchRule({ frequency: opt.value })}
                        className={cn(
                          "rounded-md px-2 py-1 text-xs font-medium",
                          value.frequency === opt.value
                            ? "bg-indigo-600 text-white"
                            : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                        )}
                      >
                        {opt.label}
                        {value.interval > 1 ? "s" : ""}
                      </button>
                    ))}
                  </div>
                </div>

                {value.frequency === "weekly" && (
                  <div>
                    <p className="mb-1.5 text-xs font-medium text-slate-400">On these days</p>
                    <div className="flex gap-1">
                      {WEEKDAY_LABELS.map((label, index) => (
                        <button
                          key={label}
                          type="button"
                          onClick={() => toggleWeekday(index)}
                          aria-pressed={value.daysOfWeek.includes(index)}
                          aria-label={label}
                          title={label}
                          className={cn(
                            "flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-semibold",
                            value.daysOfWeek.includes(index)
                              ? "bg-indigo-600 text-white"
                              : "bg-slate-100 text-slate-500 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700"
                          )}
                        >
                          {label[0]}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {value.frequency === "monthly" && (
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-slate-500 dark:text-slate-400">On day</span>
                    <input
                      type="number"
                      min={1}
                      max={31}
                      value={value.dayOfMonth ?? Number((dueDate ? calendarDateInCasablanca(new Date(dueDate)) : todayCalendarDate).slice(-2))}
                      onChange={(event) => patchRule({ dayOfMonth: Math.min(31, Math.max(1, Number(event.target.value) || 1)) })}
                      className="w-14 rounded-md border border-slate-200 px-2 py-1 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                    />
                    <span className="text-slate-400">of the month</span>
                  </div>
                )}

                <p className="rounded-md bg-slate-50 px-2 py-1.5 text-xs text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">{describeRecurrence(value)}</p>
              </div>
            )}

            <button
              type="button"
              onClick={() => setOpen(false)}
              className="mt-3 w-full rounded-md bg-slate-100 px-2 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
            >
              Done
            </button>
          </div>,
          document.body
        )}
    </div>
  );
}
