import assert from "node:assert/strict";
import { test } from "node:test";
import { casablancaTimeString, casablancaWallClockToUtc } from "./casablancaTime";
import { computeDailyAttendance, STATUS_CHECK_IN } from "./biometricStats";
import type { BiometricEmployee } from "./biometricStats";
import type { BiometricEvent, BiometricSchedule } from "@/types/biometric";

test("post-reform ZKBio wall time displays locally and counts lateness", () => {
  const punchTime = casablancaWallClockToUtc("2026-10-06 09:35:41");
  assert.equal(casablancaTimeString(punchTime), "09:35:41");

  const event: BiometricEvent = {
    id: 1,
    externalId: "transaction-1",
    empCode: "E.GHASSAN",
    employeeName: "E.GHASSAN",
    department: null,
    position: null,
    punchTime: punchTime.toISOString(),
    punchState: "0",
    punchStateLabel: STATUS_CHECK_IN,
    verifyType: null,
    terminalAlias: "Porte d'entre",
    createdAt: punchTime.toISOString(),
  };
  const employee: BiometricEmployee = {
    empCode: event.empCode,
    name: event.employeeName,
    department: null,
    color: "#000000",
    hidden: false,
    scheduleOverride: null,
    saturdayOff: false,
    monthlySalary: null,
  };
  const schedule: BiometricSchedule = {
    startTime: "09:25",
    endTime: "17:00",
    lunchBreakStart: "12:00",
    lunchBreakEnd: "13:00",
    fridayBreakStart: "12:00",
    fridayBreakEnd: "14:00",
    saturdayEndTime: "13:00",
  };

  const [attendance] = computeDailyAttendance([event], [employee], schedule);
  assert.equal(attendance.isLate, true);
  assert.equal(attendance.lateSeconds, 641);
});