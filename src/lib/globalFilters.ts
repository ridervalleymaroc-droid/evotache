import { toCasablancaDateInputValue } from "@/lib/date";
import type { Task } from "@/types/task";

export interface GlobalFilters {
  teamIds: string[];
  userIds: string[];
  projectIds: string[];
  priorities: string[];
  statuses: string[];
  dateFrom: string | null;
  dateTo: string | null;
}

export const EMPTY_GLOBAL_FILTERS: GlobalFilters = {
  teamIds: [],
  userIds: [],
  projectIds: [],
  priorities: [],
  statuses: [],
  dateFrom: null,
  dateTo: null,
};

export function hasActiveGlobalFilters(filters: GlobalFilters): boolean {
  return Boolean(
    filters.teamIds.length ||
      filters.userIds.length ||
      filters.projectIds.length ||
      filters.priorities.length ||
      filters.statuses.length ||
      filters.dateFrom ||
      filters.dateTo
  );
}

export function countActiveGlobalFilters(filters: GlobalFilters): number {
  return (
    (filters.teamIds.length ? 1 : 0) +
    (filters.userIds.length ? 1 : 0) +
    (filters.projectIds.length ? 1 : 0) +
    (filters.priorities.length ? 1 : 0) +
    (filters.statuses.length ? 1 : 0) +
    (filters.dateFrom || filters.dateTo ? 1 : 0)
  );
}

function taskMatchesGlobalFilters(task: Task, filters: GlobalFilters): boolean {
  if (filters.teamIds.length && !(task.teamIds ?? []).some((id) => filters.teamIds.includes(id))) return false;
  if (filters.userIds.length && !task.assigneeIds.some((id) => filters.userIds.includes(id))) return false;
  if (filters.projectIds.length && !(task.projectId && filters.projectIds.includes(task.projectId))) return false;
  if (filters.priorities.length && !filters.priorities.includes(task.priority)) return false;
  if (filters.statuses.length && !filters.statuses.includes(task.status)) return false;
  if (filters.dateFrom || filters.dateTo) {
    if (!task.dueDate) return false;
    const due = toCasablancaDateInputValue(task.dueDate);
    if (filters.dateFrom && due < filters.dateFrom) return false;
    if (filters.dateTo && due > filters.dateTo) return false;
  }
  return true;
}

export function applyGlobalFilters(tasks: Task[], filters: GlobalFilters): Task[] {
  if (!hasActiveGlobalFilters(filters)) return tasks;
  return tasks.filter((task) => taskMatchesGlobalFilters(task, filters));
}
