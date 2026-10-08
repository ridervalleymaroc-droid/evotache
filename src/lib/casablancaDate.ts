export const CASABLANCA_TIME_ZONE = "Africa/Casablanca";

interface CalendarParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function partsInTimeZone(date: Date, timeZone = CASABLANCA_TIME_ZONE): CalendarParts {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second),
  };
}

export function calendarDateInCasablanca(date: Date): string {
  const { year, month, day } = partsInTimeZone(date);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function dateAtCasablancaMidnight(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new RangeError(`Invalid Casablanca calendar date: ${value}`);

  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const targetUtc = Date.UTC(year, month - 1, day);
  const checkDate = new Date(targetUtc);
  if (checkDate.getUTCFullYear() !== year || checkDate.getUTCMonth() !== month - 1 || checkDate.getUTCDate() !== day) {
    throw new RangeError(`Invalid Casablanca calendar date: ${value}`);
  }

  let result = targetUtc;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const wallTime = partsInTimeZone(new Date(result));
    const wallTimeAsUtc = Date.UTC(
      wallTime.year,
      wallTime.month - 1,
      wallTime.day,
      wallTime.hour,
      wallTime.minute,
      wallTime.second
    );
    const correction = targetUtc - wallTimeAsUtc;
    result += correction;
    if (correction === 0) break;
  }

  return new Date(result);
}
