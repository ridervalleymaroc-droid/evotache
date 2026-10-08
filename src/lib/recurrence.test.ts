import assert from "node:assert/strict";
import { test } from "node:test";
import { dateAtCasablancaMidnight } from "./casablancaDate";
import { isOverdue, toCasablancaDateInputValue } from "./date";
import { computeNextOccurrence, isRecurringCompletion } from "./recurrence";

test("weekly Monday-to-Saturday recurrence advances October 6, 2026 to October 7", () => {
  const next = computeNextOccurrence(
    { frequency: "weekly", interval: 1, daysOfWeek: [1, 2, 3, 4, 5, 6], dayOfMonth: null },
    dateAtCasablancaMidnight("2026-10-06")
  );

  assert.equal(toCasablancaDateInputValue(next.toISOString()), "2026-10-07");
});

test("completing a non-recurring task does not schedule a successor", () => {
  assert.equal(isRecurringCompletion(null, "todo", "done", "done"), false);
});

test("the same completion date produces one canonical Casablanca due date in UTC, UTC+1, and UTC+2", () => {
  const originalTimeZone = process.env.TZ;
  const dates: string[] = [];

  try {
    for (const timeZone of ["UTC", "Europe/London", "Europe/Paris"]) {
      process.env.TZ = timeZone;
      const next = computeNextOccurrence(
        { frequency: "daily", interval: 1, daysOfWeek: [], dayOfMonth: null },
        dateAtCasablancaMidnight("2026-10-06")
      );
      dates.push(next.toISOString());
      assert.equal(toCasablancaDateInputValue(next.toISOString()), "2026-10-07");
    }
  } finally {
    if (originalTimeZone === undefined) delete process.env.TZ;
    else process.env.TZ = originalTimeZone;
  }

  assert.deepEqual(new Set(dates), new Set(["2026-10-06T23:00:00.000Z"]));
});

test("overdue checks use Casablanca calendar days independently of the browser timezone", () => {
  const dueAtCasablancaMidnight = dateAtCasablancaMidnight("2026-10-07").toISOString();
  const laterThatCasablancaDay = new Date(dateAtCasablancaMidnight("2026-10-07").getTime() + 12 * 60 * 60 * 1000);
  const originalTimeZone = process.env.TZ;

  try {
    for (const timeZone of ["UTC", "Europe/London", "Europe/Paris"]) {
      process.env.TZ = timeZone;
      assert.equal(isOverdue(dueAtCasablancaMidnight, laterThatCasablancaDay), false);
    }
  } finally {
    if (originalTimeZone === undefined) delete process.env.TZ;
    else process.env.TZ = originalTimeZone;
  }
});
