import { calendarDateInCasablanca, dateAtCasablancaMidnight } from "./casablancaDate";

const DAY_MS = 24 * 60 * 60 * 1000;

export function formatDueDate(iso: string | null): string {
  if (!iso) return "No due date";
  const date = new Date(iso);
  const year = Number(calendarDateInCasablanca(new Date()).slice(0, 4));
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: Number(calendarDateInCasablanca(date).slice(0, 4)) === year ? undefined : "numeric",
    timeZone: "Africa/Casablanca",
  });
}

export function isOverdue(iso: string | null, now = new Date()): boolean {
  if (!iso) return false;
  return calendarDateInCasablanca(new Date(iso)) < calendarDateInCasablanca(now);
}

export function isDueToday(iso: string | null, now = new Date()): boolean {
  if (!iso) return false;
  return calendarDateInCasablanca(new Date(iso)) === calendarDateInCasablanca(now);
}

export function isToday(iso: string, now = new Date()): boolean {
  return calendarDateInCasablanca(new Date(iso)) === calendarDateInCasablanca(now);
}

export function isDueSoon(iso: string | null, now = new Date()): boolean {
  if (!iso) return false;
  const [dueYear, dueMonth, dueDayOfMonth] = calendarDateInCasablanca(new Date(iso)).split("-").map(Number);
  const [todayYear, todayMonth, todayDay] = calendarDateInCasablanca(now).split("-").map(Number);
  const dueDay = Date.UTC(dueYear, dueMonth - 1, dueDayOfMonth);
  const today = Date.UTC(todayYear, todayMonth - 1, todayDay);
  const diff = dueDay - today;
  return diff >= 0 && diff <= DAY_MS * 2;
}

export function toDateInputValue(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function fromDateInputValue(value: string): string | null {
  if (!value) return null;
  return new Date(`${value}T00:00:00`).toISOString();
}

export function toCasablancaDateInputValue(iso: string | null): string {
  if (!iso) return "";
  return calendarDateInCasablanca(new Date(iso));
}

export function fromCasablancaDateInputValue(value: string): string | null {
  if (!value) return null;
  return dateAtCasablancaMidnight(value).toISOString();
}

/** Same local-time reasoning as toDateInputValue(), extended with hours/minutes for `<input type="datetime-local">`. */
export function toDateTimeInputValue(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

export function fromDateTimeInputValue(value: string): string | null {
  if (!value) return null;
  return new Date(value).toISOString();
}

export function formatRelativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(diffMs / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return formatDueDate(iso);
}
