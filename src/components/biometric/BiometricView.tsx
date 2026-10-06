"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { useBiometricEvents } from "@/hooks/useBiometricEvents";
import { useBiometricEmployees } from "@/hooks/useBiometricEmployees";
import { useBiometricSchedule } from "@/hooks/useBiometricSchedule";
import { useBiometricLeaves } from "@/hooks/useBiometricLeaves";
import { useBiometricHolidays } from "@/hooks/useBiometricHolidays";
import { useBiometricPayrollAdjustments } from "@/hooks/useBiometricPayrollAdjustments";
import { usePagination } from "@/hooks/usePagination";
import { canAccessBiometrics, canManageUsers, canManageWorkflow, canViewPayroll } from "@/config/roleMeta";
import { saveBiometricEmployeeOverride } from "@/services/biometricEmployeeApi";
import type { BiometricEmployeeOverridePatch } from "@/services/biometricEmployeeApi";
import { saveBiometricSchedule } from "@/services/biometricScheduleApi";
import { createBiometricLeave, deleteBiometricLeave } from "@/services/biometricLeaveApi";
import { createBiometricHoliday, deleteBiometricHoliday } from "@/services/biometricHolidayApi";
import { saveBiometricPayrollAdjustment } from "@/services/biometricPayrollAdjustmentApi";
import { BiometricEmployeeSelectorBar } from "./BiometricEmployeeSelectorBar";
import { BiometricEmployeeManager } from "./BiometricEmployeeManager";
import { BiometricScheduleEditor } from "./BiometricScheduleEditor";
import { BiometricPayrollSection } from "./BiometricPayrollSection";
import { BiometricMonthlyGrid } from "./BiometricMonthlyGrid";
import { BiometricSectionTitle } from "./BiometricSectionTitle";
import { BiometricDateRangePicker } from "./BiometricDateRangePicker";
import { BiometricTimeRangePicker } from "./BiometricTimeRangePicker";
import { FilterMenu } from "@/components/ui/FilterMenu";
import { Pagination } from "@/components/ui/Pagination";
import { Avatar } from "@/components/ui/Avatar";
import { StatTile } from "@/components/stats/StatTile";
import { ChartCard } from "@/components/stats/ChartCard";
import { BarChart } from "@/components/stats/BarChart";
import { PieChart } from "@/components/stats/PieChart";
import { TaskListSkeleton } from "@/components/task-list/TaskListSkeleton";
import { useToast } from "@/components/ui/Toast";
import { formatDueDate } from "@/lib/date";
import { cn } from "@/lib/cn";
import { addCalendarDays, casablancaDateKey, casablancaHourMinute, casablancaTimeString } from "@/lib/casablancaTime";
import {
  STATUS_BADGE,
  STATUS_CHECK_IN,
  STATUS_CHECK_OUT,
  STATUS_LABEL,
  computeDailyAttendance,
  computeMonthlyAbsences,
  computePayroll,
  countByEmployee,
  countByStatus,
  countLateByEmployee,
  deriveEmployees,
  eventsForEmployee,
  formatAbsenceDates,
  formatLateDuration,
  getAbsentEmployees,
  getPresentEmployees,
  isWithinWorkHours,
  latestLocalDate,
  resolveEmployeeSchedule,
} from "@/lib/biometricStats";
import {
  AlertTriangleIcon,
  CalendarIcon,
  CheckIcon,
  ChevronDownIcon,
  ClockIcon,
  FingerprintIcon,
  PencilIcon,
  PhoneMissedIcon,
  RefreshIcon,
  SearchIcon,
  SortIcon,
  UsersIcon,
  XIcon,
} from "@/components/ui/icons";
import type { BiometricEvent } from "@/types/biometric";

const NO_DEPARTMENT_LABEL = "Sans département";

type SortField = "employee" | "department" | "status" | "punchTime";

const COLUMN_SORT_FIELD: { label: string; field: SortField }[] = [
  { label: "Employé", field: "employee" },
  { label: "Département", field: "department" },
  { label: "Statut", field: "status" },
  { label: "Date", field: "punchTime" },
];

function sortValue(event: BiometricEvent, field: SortField): string {
  switch (field) {
    case "employee":
      return event.employeeName;
    case "department":
      return event.department || NO_DEPARTMENT_LABEL;
    case "status":
      return event.punchStateLabel;
    case "punchTime":
      return event.punchTime;
  }
}

// Always Casablanca time, regardless of the viewer's own PC/browser
// timezone — confirmed live that some office PCs have theirs set wrong
// (e.g. "Morocco +3"), which made punch times and lateness read 2-3h off
// for anyone looking at the page from one of those machines even though
// the underlying stored punchTime was correct. formatEventTime doubles as
// both the display string and (via eventHourMinute) the filter comparison
// key, so this same fix covers both.
function formatEventTime(iso: string): string {
  return casablancaTimeString(iso);
}

function eventHourMinute(iso: string): string {
  return casablancaHourMinute(iso);
}

function localMonthKey(iso: string): string {
  return casablancaDateKey(iso).slice(0, 7);
}

// `todayWord` when the reference day is today, "hier" for yesterday,
// otherwise the actual date — filtering to a past day and still reading
// as "today" would be misleading now that both the présence panel and the
// attendance detail table are filter-driven (see getPresentEmployees).
function dayLabel(dayKey: string | null, todayWord: string): string {
  if (!dayKey) return todayWord;
  const todayKey = casablancaDateKey(new Date());
  if (dayKey === todayKey) return todayWord;
  if (dayKey === addCalendarDays(todayKey, -1)) return "hier";
  const [, month, day] = dayKey.split("-");
  return `le ${day}/${month}`;
}

export function BiometricView() {
  const { user } = useAuth();
  const router = useRouter();
  const allowed = user ? canAccessBiometrics(user) : false;
  // A view-only granted user (see roleMeta.canAccessBiometrics) can see
  // this page but shouldn't get admin-only actions: editing the working
  // hours schedule or employee display overrides.
  const isManagerOrAdmin = user ? canManageUsers(user.role) || canManageWorkflow(user.role) : false;
  // Salaires is stricter than isManagerOrAdmin: even a regular admin can no
  // longer see or edit it, only the one super_admin account.
  const canSeePayroll = user ? canViewPayroll(user.role) : false;
  const { events, stats, loading } = useBiometricEvents();
  const { overrides, refetch: refetchOverrides } = useBiometricEmployees();
  const { schedule, refetch: refetchSchedule } = useBiometricSchedule();
  const { leaves, refetch: refetchLeaves } = useBiometricLeaves();
  const { holidays, refetch: refetchHolidays } = useBiometricHolidays();
  const toast = useToast();
  const [managingEmployees, setManagingEmployees] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [departmentFilter, setDepartmentFilter] = useState<string[]>([]);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [dateRangeLabel, setDateRangeLabel] = useState("Toutes les dates");
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [timeFrom, setTimeFrom] = useState("");
  const [timeTo, setTimeTo] = useState("");
  const [businessHoursOnly, setBusinessHoursOnly] = useState(false);
  const [timeRangeLabel, setTimeRangeLabel] = useState("Toute la journée");
  const [timePickerOpen, setTimePickerOpen] = useState(false);
  const [pageSize, setPageSize] = useState<number | "all">(20);
  const [sortField, setSortField] = useState<SortField>("punchTime");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [selectedEmpCode, setSelectedEmpCode] = useState<string | null>(null);
  const [absenceMonthKey, setAbsenceMonthKey] = useState(() => casablancaDateKey(new Date()).slice(0, 7));
  // Its own month, independent of the Absences section's: payroll is
  // typically reviewed for the month that just closed while absences are
  // still being checked for the current one.
  const [payrollMonthKey, setPayrollMonthKey] = useState(() => casablancaDateKey(new Date()).slice(0, 7));
  const [dailyGridMonthKey, setDailyGridMonthKey] = useState(() => casablancaDateKey(new Date()).slice(0, 7));
  const { adjustments: payrollAdjustments, refetch: refetchPayrollAdjustments } = useBiometricPayrollAdjustments(payrollMonthKey);

  // Employees, derived from the synced punch events themselves — shown as
  // an avatar-row selector matching the Calls page's ThreeCxUserSelectorBar,
  // not fetched via a separate "list employees" API call.
  const employees = useMemo(() => deriveEmployees(events, overrides), [events, overrides]);
  const employeeByCode = useMemo(() => new Map(employees.map((e) => [e.empCode, e])), [employees]);

  // If the selected employee gets hidden (this tab or another), stop
  // filtering by a code that's no longer selectable — derived at render
  // time rather than via an effect + setState, which would trigger an
  // extra render.
  const effectiveSelectedEmpCode = selectedEmpCode && !employees.find((e) => e.empCode === selectedEmpCode)?.hidden ? selectedEmpCode : null;

  async function handleSaveEmployeeOverride(empCode: string, patch: BiometricEmployeeOverridePatch) {
    try {
      await saveBiometricEmployeeOverride(empCode, patch);
      refetchOverrides();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Échec de la mise à jour.");
    }
  }

  async function handleSaveSchedule(next: typeof schedule) {
    try {
      await saveBiometricSchedule(next);
      refetchSchedule();
      toast.success("Heures de travail mises à jour.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Échec de la mise à jour.");
    }
  }

  async function handleAddLeave(empCode: string, startDate: string, endDate: string, reason: string | null) {
    await createBiometricLeave({ empCode, startDate, endDate, reason });
    refetchLeaves();
    toast.success("Conge enregistre.");
  }

  async function handleDeleteLeave(id: string) {
    try {
      await deleteBiometricLeave(id);
      refetchLeaves();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Echec de la suppression.");
    }
  }

  async function handleAddHoliday(date: string, name: string) {
    await createBiometricHoliday(date, name);
    refetchHolidays();
    toast.success("Jour ferie enregistre.");
  }

  async function handleDeleteHoliday(id: string) {
    try {
      await deleteBiometricHoliday(id);
      refetchHolidays();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Echec de la suppression.");
    }
  }

  async function handleSaveSalary(empCode: string, salary: number | null) {
    await handleSaveEmployeeOverride(empCode, { monthlySalary: salary });
  }

  // Avance/prime are per (employee, month) — unlike salaire above, saved
  // on payrollMonthKey specifically, not the employee override. Virement
  // itself is no longer entered at all (computeVirement derives it from
  // the salary), so there's no handler for it anymore.
  async function handleSaveAdvance(empCode: string, amount: number) {
    try {
      await saveBiometricPayrollAdjustment(empCode, payrollMonthKey, { advance: amount });
      refetchPayrollAdjustments();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Échec de la mise à jour.");
    }
  }

  async function handleSaveBonus(empCode: string, amount: number) {
    try {
      await saveBiometricPayrollAdjustment(empCode, payrollMonthKey, { bonus: amount });
      refetchPayrollAdjustments();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Échec de la mise à jour.");
    }
  }

  function handleSort(field: SortField) {
    if (field === sortField) setSortDirection((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortField(field);
      setSortDirection("asc");
    }
  }

  // Data arrives via a local script pushing to /api/biometric/ingest (the
  // device is on a private network Hostinger can't reach), not a pull from
  // this page — so there's no "sync now" action here, just the automatic
  // poll (useBiometricEvents refreshes on its own).

  // Built from whatever values are actually present in the synced data,
  // rather than a hardcoded list — adapts automatically if the device ever
  // returns a status beyond the ones already mapped in STATUS_LABEL.
  const statusOptions = useMemo(() => {
    const values = new Set<string>();
    for (const e of events) values.add(e.punchStateLabel);
    return Array.from(values)
      .sort()
      .map((v) => ({ value: v, label: STATUS_LABEL[v] ?? v }));
  }, [events]);
  const departmentOptions = useMemo(() => {
    const values = new Set<string>();
    for (const e of events) values.add(e.department || NO_DEPARTMENT_LABEL);
    return Array.from(values)
      .sort()
      .map((v) => ({ value: v, label: v }));
  }, [events]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    const base = effectiveSelectedEmpCode ? eventsForEmployee(events, effectiveSelectedEmpCode) : events;
    return base.filter((e) => {
      if (query && !e.employeeName.toLowerCase().includes(query) && !e.empCode.toLowerCase().includes(query)) return false;
      if (statusFilter.length && !statusFilter.includes(e.punchStateLabel)) return false;
      if (departmentFilter.length && !departmentFilter.includes(e.department || NO_DEPARTMENT_LABEL)) return false;
      if (dateFrom && e.punchTime < dateFrom) return false;
      if (dateTo && e.punchTime > `${dateTo}T23:59:59`) return false;
      if (businessHoursOnly) {
        const emp = employeeByCode.get(e.empCode);
        const effectiveSchedule = emp ? resolveEmployeeSchedule(emp, schedule) : schedule;
        if (!isWithinWorkHours(e.punchTime, effectiveSchedule)) return false;
      } else if (timeFrom || timeTo) {
        const hm = eventHourMinute(e.punchTime);
        if (timeFrom && hm < timeFrom) return false;
        if (timeTo && hm > timeTo) return false;
      }
      return true;
    });
  }, [events, search, statusFilter, departmentFilter, dateFrom, dateTo, timeFrom, timeTo, businessHoursOnly, effectiveSelectedEmpCode, schedule, employeeByCode]);

  // Driven by the filtered set (not the raw events) so search/statut/
  // département/date/heure narrow down who can show up here too — someone
  // outside the active filters shouldn't appear as "present" just because
  // their last punch happened to be a check-in. getPresentEmployees scopes
  // itself to whichever day is most recent within that filtered set, so a
  // date filter pointing at a past day shows who was present *that* day
  // instead of always reading as "right now".
  const presentEmployees = useMemo(() => getPresentEmployees(filtered, employees), [filtered, employees]);
  const presentDay = useMemo(() => latestLocalDate(filtered), [filtered]);

  // "Détail des présences" drills into a single day rather than listing
  // every day in the filtered window at once — same reference day as the
  // présence panel above, so it reads as "today" with no filter and
  // switches to whichever day gets filtered to (e.g. "hier") instead of
  // mixing several days' rows together in one table.
  const detailDayEvents = useMemo(() => (presentDay ? filtered.filter((e) => casablancaDateKey(e.punchTime) === presentDay) : []), [filtered, presentDay]);

  // Monthly late count for the "Retards ce mois" column — the month of the
  // same reference day used above, so it reads as the current month with
  // no filter, or the month of whichever day gets filtered to. Built from
  // the full unfiltered history (not `filtered`/`detailDayEvents`, which
  // are narrowed to a single day) so a day filter doesn't also shrink the
  // month it's counting within.
  const referenceMonthKey = useMemo(() => (presentDay ? presentDay.slice(0, 7) : casablancaDateKey(new Date()).slice(0, 7)), [presentDay]);
  const monthEvents = useMemo(() => {
    const base = effectiveSelectedEmpCode ? eventsForEmployee(events, effectiveSelectedEmpCode) : events;
    return base.filter((e) => localMonthKey(e.punchTime) === referenceMonthKey);
  }, [events, effectiveSelectedEmpCode, referenceMonthKey]);
  const monthLateCountByEmp = useMemo(() => {
    const rows = computeDailyAttendance(monthEvents, employees, schedule);
    const counts = new Map<string, number>();
    for (const row of rows) {
      if (!row.isLate) continue;
      counts.set(row.empCode, (counts.get(row.empCode) ?? 0) + 1);
    }
    return counts;
  }, [monthEvents, employees, schedule]);
  // Total late duration for the month, not just how many days — same rows
  // as monthLateCountByEmp, just summing lateSeconds instead of counting.
  const monthLateSecondsByEmp = useMemo(() => {
    const rows = computeDailyAttendance(monthEvents, employees, schedule);
    const totals = new Map<string, number>();
    for (const row of rows) {
      if (!row.isLate) continue;
      totals.set(row.empCode, (totals.get(row.empCode) ?? 0) + row.lateSeconds);
    }
    return totals;
  }, [monthEvents, employees, schedule]);

  const sorted = useMemo(() => {
    const copy = [...filtered];
    copy.sort((a, b) => {
      const cmp = sortValue(a, sortField).localeCompare(sortValue(b, sortField));
      return sortDirection === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [filtered, sortField, sortDirection]);

  const hasActiveFilter = Boolean(
    search.trim() || statusFilter.length || departmentFilter.length || dateFrom || dateTo || timeFrom || timeTo || businessHoursOnly || effectiveSelectedEmpCode
  );

  function clearFilters() {
    setSearch("");
    setStatusFilter([]);
    setDepartmentFilter([]);
    setDateFrom("");
    setDateTo("");
    setDateRangeLabel("Toutes les dates");
    setTimeFrom("");
    setTimeTo("");
    setBusinessHoursOnly(false);
    setTimeRangeLabel("Toute la journée");
    setSelectedEmpCode(null);
  }

  // With no filter active, the tiles use the real aggregate counts from the
  // API (`stats`) rather than the fetched/capped `events` list — otherwise
  // "Total pointages" would freeze once the real count passes MAX_ROWS (the
  // /api/calls "Total appels" bug taught this lesson). Once a filter
  // narrows things down, there's no equivalent aggregate query per filter
  // combination, so the tiles fall back to counting within that capped
  // recent-history window, same as the table/charts below.
  const kpis = useMemo(() => {
    if (!hasActiveFilter) {
      const checkInPct = stats.total ? Math.round((stats.checkIns / stats.total) * 100) : 0;
      const checkOutPct = stats.total ? Math.round((stats.checkOuts / stats.total) * 100) : 0;
      return { total: stats.total, checkIns: stats.checkIns, checkOuts: stats.checkOuts, checkInPct, checkOutPct, uniqueEmployees: stats.uniqueEmployees };
    }
    const checkIns = filtered.filter((e) => e.punchStateLabel === STATUS_CHECK_IN);
    const checkOuts = filtered.filter((e) => e.punchStateLabel === STATUS_CHECK_OUT);
    const checkInPct = filtered.length ? Math.round((checkIns.length / filtered.length) * 100) : 0;
    const checkOutPct = filtered.length ? Math.round((checkOuts.length / filtered.length) * 100) : 0;
    const uniqueEmployees = new Set(filtered.map((e) => e.empCode)).size;
    return { total: filtered.length, checkIns: checkIns.length, checkOuts: checkOuts.length, checkInPct, checkOutPct, uniqueEmployees };
  }, [filtered, hasActiveFilter, stats]);

  const { page, setPage, pageCount, start, end } = usePagination(sorted.length, pageSize);
  const paged = sorted.slice(start, end);

  // Charts follow the same filtered set as the KPI tiles, so narrowing by
  // employee/status/department/date visibly reshapes them too.
  const statusChart = useMemo(() => countByStatus(filtered), [filtered]);
  const employeeChart = useMemo(() => countByEmployee(filtered, employees), [filtered, employees]);

  // Same single reference day as "Présents"/"Détail des présences" — today
  // by default, or whichever day gets filtered to. Scoping this to the
  // whole filtered history instead would mean almost nobody ever reads as
  // absent, since most employees have punched *at some point* across the
  // full history; "absent" only means something relative to one day.
  const absentEmployees = useMemo(() => getAbsentEmployees(employees, detailDayEvents), [employees, detailDayEvents]);

  // The chart covers the full filtered period; the KPI and detail table use
  // the same single reference day so their lateness count agrees.
  const periodAttendance = useMemo(() => computeDailyAttendance(filtered, employees, schedule), [filtered, employees, schedule]);
  const lateChart = useMemo(() => countLateByEmployee(periodAttendance), [periodAttendance]);
  const dailyAttendance = useMemo(() => computeDailyAttendance(detailDayEvents, employees, schedule), [detailDayEvents, employees, schedule]);
  const lateCount = useMemo(() => dailyAttendance.filter((r) => r.isLate).length, [dailyAttendance]);

  // "Absences" section under Détail des présences — its own month/year
  // filter (independent of the page's other filters), built from the full
  // unfiltered history (not `filtered`) so it always reflects the whole
  // roster/month regardless of search/date filters set elsewhere on the
  // page. Absence = no punch at all, any terminal — deliberately not
  // scoped to the main entrance (see computeMonthlyAbsences's docs).
  const monthlyAbsences = useMemo(
    () => computeMonthlyAbsences(events, employees, leaves, holidays, absenceMonthKey, casablancaDateKey(new Date())),
    [events, employees, leaves, holidays, absenceMonthKey]
  );

  // Payroll is super_admin-only (the API refuses it for anyone else, and
  // strips salary/virement from the underlying employee-override response
  // entirely), so it isn't computed at all for anyone else — computing it
  // client-side would be pointless anyway once the API already omits the
  // salary/virement fields it needs.
  const payrollRows = useMemo(
    () =>
      canSeePayroll
        ? computePayroll(events, employees, leaves, holidays, payrollAdjustments, schedule, payrollMonthKey, casablancaDateKey(new Date()))
        : [],
    [canSeePayroll, events, employees, leaves, holidays, payrollAdjustments, schedule, payrollMonthKey]
  );

  useEffect(() => {
    if (user && !allowed) router.replace("/");
  }, [user, allowed, router]);

  if (!allowed) return null;

  return (
    <div className="mx-auto flex w-full max-w-[95%] flex-col gap-4 px-4 py-8 sm:px-6 lg:px-8">
      <header className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-50">Biométrie</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Historique des pointages — reçu automatiquement depuis la pointeuse biométrique.</p>
        </div>
        <p className="inline-flex shrink-0 items-center gap-1.5 self-start text-xs text-slate-400 dark:text-slate-500">
          <RefreshIcon className="h-3.5 w-3.5 motion-safe:animate-spin motion-safe:[animation-duration:3s]" />
          Actualisation automatique toutes les minutes
        </p>
      </header>

      {loading && <TaskListSkeleton />}

      {!loading && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <label className="relative w-full sm:w-64">
              <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Rechercher un employé…"
                className="w-full rounded-lg border border-slate-200 bg-white py-1.5 pl-8 pr-2.5 text-sm text-slate-700 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:focus:ring-indigo-950"
              />
            </label>
            {statusOptions.length > 0 && (
              <FilterMenu label="Statut" count={statusFilter.length} options={statusOptions} value={statusFilter} onChange={setStatusFilter} />
            )}
            {departmentOptions.length > 0 && (
              <FilterMenu label="Département" count={departmentFilter.length} options={departmentOptions} value={departmentFilter} onChange={setDepartmentFilter} />
            )}
            <button
              type="button"
              onClick={() => setDatePickerOpen(true)}
              className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              <CalendarIcon className="h-3.5 w-3.5 shrink-0 opacity-60" />
              <span className="max-w-[220px] truncate" title={dateRangeLabel}>
                {dateRangeLabel}
              </span>
              <ChevronDownIcon className="h-3.5 w-3.5 shrink-0 opacity-60" />
            </button>
            <button
              type="button"
              onClick={() => setTimePickerOpen(true)}
              className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              <ClockIcon className="h-3.5 w-3.5 shrink-0 opacity-60" />
              <span className="max-w-[220px] truncate" title={timeRangeLabel}>
                {timeRangeLabel}
              </span>
              <ChevronDownIcon className="h-3.5 w-3.5 shrink-0 opacity-60" />
            </button>
            <BiometricDateRangePicker
              open={datePickerOpen}
              onClose={() => setDatePickerOpen(false)}
              onApply={(range, label) => {
                setDateFrom(range.from ?? "");
                setDateTo(range.to ?? "");
                setDateRangeLabel(label);
              }}
            />
            <BiometricTimeRangePicker
              open={timePickerOpen}
              onClose={() => setTimePickerOpen(false)}
              onApply={(range, label, businessHours) => {
                setBusinessHoursOnly(Boolean(businessHours));
                setTimeFrom(businessHours ? "" : range.from);
                setTimeTo(businessHours ? "" : range.to);
                setTimeRangeLabel(label);
              }}
            />
            {hasActiveFilter && (
              <button
                type="button"
                onClick={clearFilters}
                className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
              >
                <XIcon className="h-3.5 w-3.5" />
                Effacer les filtres
              </button>
            )}
          </div>

          {/* Signature section: who's actually in the building right now —
              the one question raw punch data can answer that call data
              never could, so it leads the page instead of a KPI-tiles row. */}
          <section className="relative overflow-hidden rounded-2xl border border-teal-100 bg-gradient-to-br from-teal-50 via-white to-white p-5 shadow-sm dark:border-teal-900/50 dark:from-teal-950/30 dark:via-slate-900 dark:to-slate-900">
            <BiometricSectionTitle icon={<UsersIcon className="h-5 w-5 text-teal-500" />}>Présence en direct</BiometricSectionTitle>
            <div className="mt-3 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <span className="relative flex h-3 w-3 shrink-0">
                  <span className="motion-safe:absolute motion-safe:inline-flex motion-safe:h-full motion-safe:w-full motion-safe:animate-ping motion-safe:rounded-full motion-safe:bg-teal-400 motion-safe:opacity-75" />
                  <span className="relative inline-flex h-3 w-3 rounded-full bg-teal-500" />
                </span>
                <div>
                  <p className="text-3xl font-bold tabular-nums leading-none text-teal-700 dark:text-teal-300">{presentEmployees.length}</p>
                  <p className="mt-1 text-sm font-medium text-slate-600 dark:text-slate-300">
                    présent{presentEmployees.length !== 1 ? "s" : ""} {dayLabel(presentDay, "maintenant")}
                  </p>
                </div>
              </div>
              {presentEmployees[0] && (
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Dernière arrivée : <span className="font-medium text-slate-700 dark:text-slate-200">{presentEmployees[0].name}</span> à{" "}
                  {formatEventTime(presentEmployees[0].lastPunchTime)}
                </p>
              )}
            </div>

            {presentEmployees.length > 0 ? (
              <div className="mt-4 flex items-center gap-3 overflow-x-auto pb-1">
                {presentEmployees.map((e) => (
                  <div key={e.empCode} className="flex shrink-0 flex-col items-center gap-1">
                    <Avatar name={e.name} color={e.color} size="md" className="ring-2 ring-teal-200 dark:ring-teal-800" />
                    <span className="max-w-[64px] truncate text-[11px] text-slate-500 dark:text-slate-400" title={e.name}>
                      {e.name.split(" ")[0]}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-3 text-xs text-slate-400">Personne n&apos;est actuellement pointé comme présent.</p>
            )}
          </section>

          <BiometricEmployeeSelectorBar
            employees={employees}
            selectedEmpCode={effectiveSelectedEmpCode}
            onSelect={setSelectedEmpCode}
            onManage={isManagerOrAdmin ? () => setManagingEmployees(true) : undefined}
          />
          <BiometricEmployeeManager
            open={managingEmployees}
            employees={employees}
            globalSchedule={schedule}
            leaves={leaves}
            holidays={holidays}
            onClose={() => setManagingEmployees(false)}
            onSave={handleSaveEmployeeOverride}
            onAddLeave={handleAddLeave}
            onDeleteLeave={handleDeleteLeave}
            onAddHoliday={handleAddHoliday}
            onDeleteHoliday={handleDeleteHoliday}
          />

          <section className="sticky top-0 z-10 grid grid-cols-2 gap-3 bg-slate-50 py-2 sm:grid-cols-3 lg:grid-cols-5 dark:bg-slate-950">
            <StatTile label="Total pointages" value={kpis.total} icon={<FingerprintIcon className="h-4.5 w-4.5" />} />
            <StatTile label="Entrées" value={`${kpis.checkIns} (${kpis.checkInPct}%)`} icon={<CheckIcon className="h-4.5 w-4.5" />} />
            <StatTile label="Sorties" value={`${kpis.checkOuts} (${kpis.checkOutPct}%)`} icon={<PhoneMissedIcon className="h-4.5 w-4.5" />} />
            <StatTile label="Employés" value={kpis.uniqueEmployees} icon={<UsersIcon className="h-4.5 w-4.5" />} />
            <StatTile label="Retards" value={lateCount} icon={<AlertTriangleIcon className="h-4.5 w-4.5" />} tone={lateCount > 0 ? "warning" : "default"} />
          </section>

          {/* Asymmetric on purpose (2:1 rather than three equal thirds) —
              the employee ranking is the most actionable chart, so it leads
              wide, with the remaining breakdowns stacked beside it instead
              of competing for equal weight. Absents is nested into this
              same left column (stacked above the ranking chart) rather
              than placed as its own full-width section after the grid: a
              CSS grid row is always as tall as its tallest column, so a
              section placed right after the grid would sit below empty
              space equal to however much shorter the left column was —
              nesting it here lets it flow immediately under Absents
              instead, using that space rather than leaving it empty. */}
          <section className="grid grid-cols-1 items-start gap-4 lg:grid-cols-3">
            <div className="flex flex-col gap-4 lg:col-span-2">
              {/* Driven by the same filtered set as the charts above —
                  unlike "présents maintenant", absence only means something
                  relative to a period, so it changes as the
                  date/département/etc. filters below change. */}
              <section className="rounded-2xl border border-amber-100 bg-amber-50/40 p-5 dark:border-amber-900/40 dark:bg-amber-950/10">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <BiometricSectionTitle icon={<AlertTriangleIcon className="h-5 w-5 text-amber-500" />} suffix={"— " + dayLabel(presentDay, "aujourd'hui")}>
                      Absents
                    </BiometricSectionTitle>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Aucun pointage ce jour-là</p>
                  </div>
                  <span className="text-2xl font-bold tabular-nums leading-none text-amber-600 dark:text-amber-400">{absentEmployees.length}</span>
                </div>

                {absentEmployees.length > 0 ? (
                  <div className="mt-4 flex flex-wrap items-center gap-3">
                    {absentEmployees.map((e) => (
                      <div key={e.empCode} className="flex flex-col items-center gap-1">
                        <Avatar name={e.name} color={e.color} size="md" className="opacity-60 grayscale" />
                        <span className="max-w-[64px] truncate text-[11px] text-slate-500 dark:text-slate-400" title={e.name}>
                          {e.name.split(" ")[0]}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-3 text-xs text-slate-400">Tout le monde a pointé ce jour-là.</p>
                )}
              </section>

              <ChartCard title="Pointages par employé">
                <BarChart data={employeeChart} />
              </ChartCard>
            </div>
            <div className="flex flex-col gap-4">
              <ChartCard title="Par statut">
                <PieChart data={statusChart} />
              </ChartCard>
              <ChartCard title="Retards par employé">
                <BarChart data={lateChart} />
              </ChartCard>
            </div>
          </section>

          {/* One row per employee for a single day — the same reference day
              as the présence panel above (today by default, or whichever
              day gets filtered to), not every day in the filtered window
              at once. Entrée = premier pointage "Enregistrement" du jour,
              sortie = dernier "Départ" du jour. Le retard est calculé
              contre l'heure de début configurable ci-dessous. */}
          <section className="rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 dark:border-slate-800">
              <div>
                <BiometricSectionTitle icon={<ClockIcon className="h-5 w-5 text-indigo-500" />} suffix={"— " + dayLabel(presentDay, "aujourd'hui")}>
                  Détail des présences
                </BiometricSectionTitle>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  Retard calculé si l&apos;entrée est après {schedule.startTime}
                </p>
              </div>
              {isManagerOrAdmin && (
                <button
                  type="button"
                  onClick={() => setEditingSchedule(true)}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  <PencilIcon className="h-3.5 w-3.5" />
                  Modifier les heures de travail
                </button>
              )}
            </div>

            {dailyAttendance.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-slate-400">Aucune présence sur la période / le filtre sélectionné.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1000px] border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:border-slate-800 dark:text-slate-400">
                      <th scope="col" className="whitespace-nowrap px-4 py-2">
                        Nom
                      </th>
                      <th scope="col" className="whitespace-nowrap px-3 py-2">
                        Date
                      </th>
                      <th scope="col" className="whitespace-nowrap px-3 py-2">
                        Entrée
                      </th>
                      <th scope="col" className="whitespace-nowrap px-3 py-2">
                        Sortie
                      </th>
                      <th scope="col" className="whitespace-nowrap px-3 py-2" title="Temps entre une sortie et le retour suivant le même jour (pas de type de pointage dédié à la pause)">
                        Temps de pause
                      </th>
                      <th scope="col" className="whitespace-nowrap px-3 py-2">
                        En retard
                      </th>
                      <th scope="col" className="whitespace-nowrap px-3 py-2">
                        Temps de retard
                      </th>
                      <th scope="col" className="whitespace-nowrap px-3 py-2">
                        Retards ce mois
                      </th>
                      <th scope="col" className="whitespace-nowrap px-3 py-2">
                        Temps de retard ce mois
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {dailyAttendance.map((row) => (
                      <tr key={`${row.empCode}-${row.date}`} className="border-b border-slate-100 last:border-0 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/50">
                        <td className="whitespace-nowrap px-4 py-2 font-medium text-slate-800 dark:text-slate-100">{row.name}</td>
                        <td className="whitespace-nowrap px-3 py-2 tabular-nums text-slate-600 dark:text-slate-300">{row.date}</td>
                        <td className="whitespace-nowrap px-3 py-2 tabular-nums text-slate-600 dark:text-slate-300">
                          {row.firstEntry ? formatEventTime(row.firstEntry) : "—"}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 tabular-nums text-slate-600 dark:text-slate-300">{row.lastExit ? formatEventTime(row.lastExit) : "—"}</td>
                        <td className="whitespace-nowrap px-3 py-2 tabular-nums text-slate-600 dark:text-slate-300">
                          {row.pauseSeconds > 0 ? formatLateDuration(row.pauseSeconds) : "—"}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2">
                          {row.isLate ? (
                            <span className="inline-flex items-center gap-1 rounded-md bg-red-50 px-1.5 py-0.5 text-xs font-medium text-red-700 dark:bg-red-950 dark:text-red-300">
                              <AlertTriangleIcon className="h-3 w-3" />
                              Oui
                            </span>
                          ) : (
                            <span className="text-xs text-slate-400">Non</span>
                          )}
                        </td>
                        <td className={cn("whitespace-nowrap px-3 py-2 tabular-nums", row.isLate ? "font-medium text-red-600 dark:text-red-400" : "text-slate-400")}>
                          {row.isLate ? formatLateDuration(row.lateSeconds) : "—"}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 tabular-nums text-slate-600 dark:text-slate-300">{monthLateCountByEmp.get(row.empCode) ?? 0}</td>
                        <td className="whitespace-nowrap px-3 py-2 tabular-nums text-slate-600 dark:text-slate-300">
                          {monthLateSecondsByEmp.get(row.empCode) ? formatLateDuration(monthLateSecondsByEmp.get(row.empCode)!) : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 dark:border-slate-800">
              <div>
                <BiometricSectionTitle icon={<CalendarIcon className="h-5 w-5 text-rose-500" />}>Les absences ce mois</BiometricSectionTitle>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Jours sans aucun pointage (lundi-samedi), toutes portes confondues</p>
              </div>
              <input
                type="month"
                value={absenceMonthKey}
                onChange={(e) => e.target.value && setAbsenceMonthKey(e.target.value)}
                className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm text-slate-700 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:focus:ring-indigo-950"
              />
            </div>

            {monthlyAbsences.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-slate-400">Aucune absence ce mois-ci.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[520px] border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:border-slate-800 dark:text-slate-400">
                      <th scope="col" className="whitespace-nowrap px-4 py-2">
                        Salarié
                      </th>
                      <th scope="col" className="whitespace-nowrap px-3 py-2">
                        Nb. absences
                      </th>
                      <th scope="col" className="px-3 py-2">
                        Dates
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {monthlyAbsences.map((row) => (
                      <tr key={row.empCode} className="border-b border-slate-100 last:border-0 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/50">
                        <td className="whitespace-nowrap px-4 py-2 font-medium text-slate-800 dark:text-slate-100">{row.name}</td>
                        <td className="whitespace-nowrap px-3 py-2 tabular-nums font-medium text-red-600 dark:text-red-400">{row.dates.length}</td>
                        <td className="px-3 py-2 tabular-nums text-slate-600 dark:text-slate-300">le {formatAbsenceDates(row.dates)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <BiometricMonthlyGrid
            events={events}
            employees={employees}
            leaves={leaves}
            holidays={holidays}
            defaultSchedule={schedule}
            monthKey={dailyGridMonthKey}
            onMonthChange={setDailyGridMonthKey}
          />

          {canSeePayroll && (
            <BiometricPayrollSection
              rows={payrollRows}
              monthKey={payrollMonthKey}
              onMonthChange={setPayrollMonthKey}
              onSaveSalary={handleSaveSalary}
              onSaveAdvance={handleSaveAdvance}
              onSaveBonus={handleSaveBonus}
            />
          )}

          <BiometricScheduleEditor open={editingSchedule} schedule={schedule} onClose={() => setEditingSchedule(false)} onSave={handleSaveSchedule} />

          {sorted.length === 0 && (
            <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-slate-200 bg-white px-6 py-16 text-center dark:border-slate-800 dark:bg-slate-900">
              <FingerprintIcon className="h-10 w-10 text-slate-300 dark:text-slate-700" />
              <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
                {events.length === 0 ? "Aucun pointage reçu pour l'instant — vérifie que le script de synchronisation tourne bien." : "Aucun pointage ne correspond aux filtres."}
              </p>
            </div>
          )}

          {sorted.length > 0 && (
            <div className="min-w-0 overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <table className="w-full min-w-[760px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:border-slate-800 dark:text-slate-400">
                    {COLUMN_SORT_FIELD.map(({ label, field }) => (
                      <th key={field} scope="col" className="whitespace-nowrap px-3 py-2">
                        <button type="button" onClick={() => handleSort(field)} className="inline-flex items-center gap-1 hover:text-slate-700 dark:hover:text-slate-200">
                          {label}
                          <SortIcon
                            className={cn(
                              "h-3 w-3 transition-transform",
                              sortField === field ? "opacity-100" : "opacity-30",
                              sortField === field && sortDirection === "asc" && "rotate-180"
                            )}
                          />
                        </button>
                      </th>
                    ))}
                    <th scope="col" className="whitespace-nowrap px-3 py-2">
                      Terminal
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {paged.map((event: BiometricEvent) => (
                    <tr key={event.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/50">
                      <td className="whitespace-nowrap px-3 py-2 font-medium text-slate-800 dark:text-slate-100">{event.employeeName}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-slate-600 dark:text-slate-300">{event.department || NO_DEPARTMENT_LABEL}</td>
                      <td className="whitespace-nowrap px-3 py-2">
                        <span
                          className={cn("rounded-md px-1.5 py-0.5 text-xs font-medium", STATUS_BADGE[event.punchStateLabel] ?? "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300")}
                        >
                          {STATUS_LABEL[event.punchStateLabel] ?? event.punchStateLabel}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 tabular-nums text-slate-600 dark:text-slate-300">
                        <div>{formatDueDate(event.punchTime)}</div>
                        <div className="text-xs text-slate-400 dark:text-slate-500">{formatEventTime(event.punchTime)}</div>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-slate-600 dark:text-slate-300">{event.terminalAlias || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {sorted.length > 0 && (
            <Pagination
              page={page}
              pageCount={pageCount}
              pageSize={pageSize}
              total={sorted.length}
              rangeStart={start + 1}
              rangeEnd={end}
              onPageChange={setPage}
              onPageSizeChange={setPageSize}
              pageSizeOptions={[20, 50, 100, "all"]}
            />
          )}
        </>
      )}
    </div>
  );
}
