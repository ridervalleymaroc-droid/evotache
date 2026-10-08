import type { RecurrenceRule } from "@/types/task";
import { calendarDateInCasablanca, dateAtCasablancaMidnight } from "./casablancaDate";

export const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function isRecurringCompletion(
  recurrence: RecurrenceRule | null,
  currentStatus: string,
  nextStatus: string | undefined,
  doneStatus: string | undefined
): boolean {
  return Boolean(recurrence && doneStatus && nextStatus === doneStatus && nextStatus !== currentStatus);
}

function addCalendarDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function ordinal(n: number): string {
  const lastDigit = n % 10;
  const lastTwoDigits = n % 100;
  if (lastDigit === 1 && lastTwoDigits !== 11) return `${n}st`;
  if (lastDigit === 2 && lastTwoDigits !== 12) return `${n}nd`;
  if (lastDigit === 3 && lastTwoDigits !== 13) return `${n}rd`;
  return `${n}th`;
}

/** Computes the next occurrence date strictly after `fromDate`, per the rule. */
export function computeNextOccurrence(rule: RecurrenceRule, fromDate: Date): Date {
  const [year, month, day] = calendarDateInCasablanca(fromDate).split("-").map(Number);
  const from = new Date(Date.UTC(year, month - 1, day));
  const interval = Math.max(1, Math.floor(rule.interval) || 1);

  if (rule.frequency === "daily") {
    return calendarMidnight(addCalendarDays(from, interval));
  }

  if (rule.frequency === "monthly") {
    const dayOfMonth = rule.dayOfMonth ?? from.getUTCDate();
    const next = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + interval, 1));
    const lastDayOfNextMonth = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
    next.setUTCDate(Math.min(dayOfMonth, lastDayOfNextMonth));
    return calendarMidnight(next);
  }

  // Weekly — anchor "week 0" at the Monday on/before `from`, so an interval > 1
  // ("every 2 weeks") skips the right number of weeks between occurrences.
  const days = rule.daysOfWeek.length
    ? Array.from(new Set(rule.daysOfWeek)).sort((a, b) => a - b)
    : [from.getUTCDay()];
  const anchorMonday = addCalendarDays(from, -((from.getUTCDay() + 6) % 7));
  for (let offset = 1; offset <= interval * 7 * 8; offset++) {
    const candidate = addCalendarDays(from, offset);
    if (!days.includes(candidate.getUTCDay())) continue;
    const candidateMonday = addCalendarDays(candidate, -((candidate.getUTCDay() + 6) % 7));
    const weeksBetween = Math.round((candidateMonday.getTime() - anchorMonday.getTime()) / (7 * 86400000));
    if (weeksBetween % interval === 0) return calendarMidnight(candidate);
  }
  return calendarMidnight(addCalendarDays(from, 7 * interval));
}

function calendarMidnight(date: Date): Date {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return dateAtCasablancaMidnight(`${year}-${month}-${day}`);
}

export function describeRecurrence(rule: RecurrenceRule | null): string {
  if (!rule) return "Does not repeat";
  const interval = Math.max(1, Math.floor(rule.interval) || 1);

  if (rule.frequency === "daily") {
    return interval === 1 ? "Every day" : `Every ${interval} days`;
  }

  if (rule.frequency === "monthly") {
    const dayLabel = rule.dayOfMonth ? `on the ${ordinal(rule.dayOfMonth)}` : "on the same day";
    return interval === 1 ? `Every month ${dayLabel}` : `Every ${interval} months ${dayLabel}`;
  }

  const days = rule.daysOfWeek.length ? [...rule.daysOfWeek].sort((a, b) => a - b).map((d) => WEEKDAY_LABELS[d]) : [];
  const dayList = days.length ? days.join(", ") : "the same day";
  return interval === 1 ? `Every ${dayList}` : `Every ${interval} weeks on ${dayList}`;
}
