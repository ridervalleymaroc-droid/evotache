"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { CalendarIcon, ChevronLeftIcon, ChevronRightIcon, XIcon } from "@/components/ui/icons";
import { calendarDateInCasablanca, dateAtCasablancaMidnight } from "@/lib/casablancaDate";
import { formatCalendarDate, isDueSoon, isOverdue } from "@/lib/date";
import { useLanguage } from "@/hooks/useLanguage";
import { cn } from "@/lib/cn";
import type { TranslationKey } from "@/i18n/en";

interface DueDateMenuProps {
  /** Omit both to render a single Due-date trigger only (e.g. a narrow table cell) instead of the Start date + Due date pair. */
  startDate?: string | null;
  dueDate: string | null;
  onChangeStart?: (next: string | null) => void;
  onChangeDue: (next: string | null) => void;
  readOnly?: boolean;
}

type ActiveField = "start" | "due";

const WEEKDAY_LABELS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

function startOfDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function dateOnlyInCasablanca(date: Date): Date {
  const [year, month, day] = calendarDateInCasablanca(date).split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getUTCFullYear() === b.getUTCFullYear() && a.getUTCMonth() === b.getUTCMonth() && a.getUTCDate() === b.getUTCDate();
}

function toIso(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return dateAtCasablancaMidnight(`${year}-${month}-${day}`).toISOString();
}

function formatShort(date: Date): string {
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
}

function formatBoxValue(iso: string | null, locale: "en" | "fr"): string {
  if (!iso) return "";
  return formatCalendarDate(iso, locale === "fr" ? "fr-FR" : "en-US");
}

interface Shortcut {
  label: TranslationKey;
  date: Date;
}

function buildShortcuts(today: Date): Shortcut[] {
  const dow = today.getUTCDay(); // 0=Sun..6=Sat
  const thisWeekend = dow === 6 ? today : addDays(today, (6 - dow + 7) % 7);
  const nextWeek = addDays(today, ((1 - dow + 7) % 7) || 7);
  const nextWeekend = addDays(thisWeekend, 7);
  return [
    { label: "dueDate.today", date: today },
    { label: "dueDate.tomorrow", date: addDays(today, 1) },
    { label: "dueDate.thisWeekend", date: thisWeekend },
    { label: "dueDate.nextWeek", date: nextWeek },
    { label: "dueDate.nextWeekend", date: nextWeekend },
    { label: "dueDate.twoWeeks", date: addDays(today, 14) },
    { label: "dueDate.fourWeeks", date: addDays(today, 28) },
  ];
}

function buildMonthGrid(viewMonth: Date): Date[] {
  const first = new Date(Date.UTC(viewMonth.getUTCFullYear(), viewMonth.getUTCMonth(), 1));
  const gridStart = addDays(first, -first.getUTCDay());
  return Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
}

export function DueDateMenu({ startDate = null, dueDate, onChangeStart, onChangeDue, readOnly }: DueDateMenuProps) {
  const { t, locale } = useLanguage();
  const showStart = Boolean(onChangeStart);
  const [open, setOpen] = useState(false);
  const [activeField, setActiveField] = useState<ActiveField>("due");
  const [viewMonth, setViewMonth] = useState(() => dateOnlyInCasablanca(new Date()));
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const startTriggerRef = useRef<HTMLButtonElement>(null);
  const dueTriggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const today = dateOnlyInCasablanca(new Date());
  const overdue = isOverdue(dueDate);
  const soon = isDueSoon(dueDate);

  const updatePosition = useCallback(() => {
    const trigger = (activeField === "start" ? startTriggerRef.current : dueTriggerRef.current) ?? dueTriggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const left = Math.min(rect.left, window.innerWidth - 336);
    setPosition({ top: rect.bottom + 6, left: Math.max(8, left) });
  }, [activeField]);

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
    function onPointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (
        panelRef.current?.contains(target) ||
        startTriggerRef.current?.contains(target) ||
        dueTriggerRef.current?.contains(target)
      ) {
        return;
      }
      setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  function openFor(field: ActiveField) {
    if (readOnly) return;
    setActiveField(field);
    const current = field === "start" ? startDate : dueDate;
    setViewMonth(current ? dateOnlyInCasablanca(new Date(current)) : today);
    setOpen(true);
  }

  function pick(date: Date) {
    const iso = toIso(date);
    if (activeField === "start") onChangeStart?.(iso);
    else onChangeDue(iso);
    setViewMonth(startOfDay(date));
  }

  function onPanelKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.stopPropagation();
      setOpen(false);
    }
  }

  const toneClass = overdue
    ? "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300"
    : soon
      ? "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300"
      : "text-slate-500 dark:text-slate-400";

  if (readOnly) {
    return (
      <span className={cn("inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium", toneClass)}>
        <CalendarIcon className="h-3.5 w-3.5 shrink-0" />
        {dueDate ? formatBoxValue(dueDate, locale) : t("tasks.noDueDate")}
      </span>
    );
  }

  const shortcuts = buildShortcuts(today);
  const grid = buildMonthGrid(viewMonth);
  const activeValue = activeField === "start" ? startDate : dueDate;

  return (
    <div className="flex items-center gap-1.5">
      {showStart && (
        <button
          ref={startTriggerRef}
          type="button"
          onClick={() => openFor("start")}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium",
            open && activeField === "start" ? "border-indigo-400 ring-2 ring-indigo-100 dark:ring-indigo-950" : "border-slate-200 dark:border-slate-700",
            startDate ? "text-slate-700 dark:text-slate-200" : "text-slate-400"
          )}
        >
          <CalendarIcon className="h-3.5 w-3.5 shrink-0" />
          {startDate ? formatBoxValue(startDate, locale) : t("dueDate.startDate")}
        </button>
      )}

      <button
        ref={dueTriggerRef}
        type="button"
        onClick={() => openFor("due")}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium",
          open && activeField === "due" ? "border-indigo-400 ring-2 ring-indigo-100 dark:ring-indigo-950" : "border-slate-200 dark:border-slate-700",
          dueDate ? toneClass : "text-slate-400"
        )}
      >
        <CalendarIcon className="h-3.5 w-3.5 shrink-0" />
        {dueDate ? formatBoxValue(dueDate, locale) : t("dueDate.dueDate")}
      </button>

      {open &&
        createPortal(
          <div
            ref={panelRef}
            role="dialog"
            aria-label="Set dates"
            tabIndex={-1}
            onKeyDown={onPanelKeyDown}
            style={{ position: "fixed", top: position.top, left: position.left }}
            className="z-[95] flex w-[336px] animate-scale-in overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl focus:outline-none dark:border-slate-700 dark:bg-slate-900"
          >
            <div className="flex w-32 shrink-0 flex-col border-r border-slate-100 py-1.5 dark:border-slate-800">
              {shortcuts.map((shortcut) => (
                <button
                  key={shortcut.label}
                  type="button"
                  onClick={() => pick(shortcut.date)}
                  className="flex items-center justify-between px-2.5 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  <span>{t(shortcut.label)}</span>
                  <span className="text-slate-400">{formatShort(shortcut.date)}</span>
                </button>
              ))}
              {activeValue && (
                <button
                  type="button"
                  onClick={() => {
                    if (activeField === "start") onChangeStart?.(null);
                    else onChangeDue(null);
                  }}
                  className="mt-1 flex items-center gap-1 px-2.5 py-1.5 text-left text-xs font-medium text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950"
                >
                  <XIcon className="h-3 w-3" />
                  {t("dueDate.clear")}
                </button>
              )}
            </div>

            <div className="flex-1 p-2.5">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                  {viewMonth.toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" })}
                </p>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setViewMonth(today)}
                    className="rounded px-1.5 py-0.5 text-[11px] font-medium text-indigo-600 hover:bg-indigo-50 dark:text-indigo-400 dark:hover:bg-indigo-950"
                  >
                    {t("dueDate.today")}
                  </button>
                  <button
                    type="button"
                    aria-label="Previous month"
                    onClick={() => setViewMonth(new Date(Date.UTC(viewMonth.getUTCFullYear(), viewMonth.getUTCMonth() - 1, 1)))}
                    className="rounded p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    <ChevronLeftIcon className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    aria-label="Next month"
                    onClick={() => setViewMonth(new Date(Date.UTC(viewMonth.getUTCFullYear(), viewMonth.getUTCMonth() + 1, 1)))}
                    className="rounded p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    <ChevronRightIcon className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-7 gap-y-0.5 text-center">
                {WEEKDAY_LABELS.map((label) => (
                  <span key={label} className="text-[10px] font-medium text-slate-400">
                    {label}
                  </span>
                ))}
                {grid.map((day) => {
                  const inMonth = day.getUTCMonth() === viewMonth.getUTCMonth();
                  const isToday = isSameDay(day, today);
                  const isSelected = activeValue ? isSameDay(day, dateOnlyInCasablanca(new Date(activeValue))) : false;
                  return (
                    <button
                      key={day.toISOString()}
                      type="button"
                      onClick={() => pick(day)}
                      className={cn(
                        "mx-auto flex h-7 w-7 items-center justify-center rounded-full text-xs",
                        !inMonth && "text-slate-300 dark:text-slate-600",
                        inMonth && !isSelected && !isToday && "text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800",
                        isToday && !isSelected && "font-semibold text-indigo-600 ring-1 ring-inset ring-indigo-300 dark:text-indigo-400 dark:ring-indigo-700",
                        isSelected && "bg-indigo-600 font-semibold text-white hover:bg-indigo-600"
                      )}
                    >
                      {day.getUTCDate()}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
