import assert from "node:assert/strict";
import { test } from "node:test";
import { computeNextOccurrence } from "./recurrence";

test("weekly Monday-to-Saturday recurrence advances October 6, 2026 to October 7", () => {
  const next = computeNextOccurrence(
    { frequency: "weekly", interval: 1, daysOfWeek: [1, 2, 3, 4, 5, 6], dayOfMonth: null },
    new Date(2026, 9, 6)
  );

  assert.equal(next.getFullYear(), 2026);
  assert.equal(next.getMonth(), 9);
  assert.equal(next.getDate(), 7);
});
