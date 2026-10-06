const CASABLANCA_TZ = "Africa/Casablanca";
const CASABLANCA_GMT_CUTOVER = Date.UTC(2026, 8, 20, 1);

// ZKBio Time returns naive "YYYY-MM-DD HH:mm:ss" timestamps with no offset
// attached — they're the device's own wall-clock reading, in Morocco time.
// Converts that to a real UTC Date using the IANA zone (which also handles
// Morocco's own Ramadan DST reversion) rather than assuming the server
// process's local timezone matches.
export function casablancaWallClockToUtc(naive: string): Date {
  const isoLike = naive.trim().replace(" ", "T");
  const guess = new Date(`${isoLike}Z`);
  // Morocco returned to UTC at 02:00 local on 2026-09-20. Older Node/ICU
  // timezone data can still report UTC+1 after that legal transition.
  if (guess.getTime() >= CASABLANCA_GMT_CUTOVER) return guess;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: CASABLANCA_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(guess);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? "0");
  const casablancaDigitsAsUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  const offsetMs = casablancaDigitsAsUtc - guess.getTime();
  return new Date(guess.getTime() - offsetMs);
}

interface CasablancaParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number; // 0=Sunday..6=Saturday, matching Date#getDay()
}

const WEEKDAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

// Reads an instant's wall-clock components in the Africa/Casablanca zone
// specifically — never the viewer's own OS/browser timezone. Confirmed
// live: some office PCs have their timezone set wrong (e.g. "Morocco +3"
// instead of Morocco's real offset), which made punch times and lateness
// read 2-3h off for whoever was looking at the page on one of those
// machines, even though the stored punchTime itself was correct. Intl's
// `timeZone` option resolves the IANA zone's real offset independent of
// however the local OS is configured, so every viewer sees the same
// wall-clock time no matter their own PC's clock/timezone settings.
function casablancaParts(input: Date | string): CasablancaParts {
  const d = typeof input === "string" ? new Date(input) : input;
  if (d.getTime() >= CASABLANCA_GMT_CUTOVER) {
    return {
      year: d.getUTCFullYear(),
      month: d.getUTCMonth() + 1,
      day: d.getUTCDate(),
      hour: d.getUTCHours(),
      minute: d.getUTCMinutes(),
      second: d.getUTCSeconds(),
      weekday: d.getUTCDay(),
    };
  }
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: CASABLANCA_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")) % 24, // some engines format midnight as "24" with hour12: false
    minute: Number(get("minute")),
    second: Number(get("second")),
    weekday: WEEKDAY_INDEX[get("weekday")] ?? 0,
  };
}

/** "YYYY-MM-DD" calendar day in Casablanca, for the given instant. */
export function casablancaDateKey(input: Date | string): string {
  const p = casablancaParts(input);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** "HH:mm" in Casablanca, for the given instant. */
export function casablancaHourMinute(input: Date | string): string {
  const p = casablancaParts(input);
  return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}

/** "HH:mm:ss" in Casablanca, for the given instant. */
export function casablancaTimeString(input: Date | string): string {
  const p = casablancaParts(input);
  return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}:${String(p.second).padStart(2, "0")}`;
}

/** 0=Sunday..6=Saturday in Casablanca, for the given instant. */
export function casablancaWeekday(input: Date | string): number {
  return casablancaParts(input).weekday;
}

/** Pure calendar-date arithmetic on a "YYYY-MM-DD" key (no timezone
 * involved — it's just addition on the calendar, same idea as adding days
 * on a paper calendar), used to get e.g. "yesterday" relative to a
 * Casablanca date key without going through any Date-object local
 * timezone semantics. */
export function addCalendarDays(dateKey: string, delta: number): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + delta));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}
