import type { Assignee, GroupField, SortDirection, SortField, Task, TaskFilters } from "@/types/task";
import type { PriorityDef, StatusDef } from "@/types/taskMeta";
import { toCasablancaDateInputValue } from "@/lib/date";

export function taskMatchesFilters(task: Task, filters: TaskFilters, assigneeNameById: Record<string, string>): boolean {
  if (filters.statuses.length && !filters.statuses.includes(task.status)) return false;
  if (filters.priorities.length && !filters.priorities.includes(task.priority)) return false;
  if (filters.assigneeIds.length && !task.assigneeIds.some((id) => filters.assigneeIds.includes(id))) return false;
  if (filters.projectIds.length && !(task.projectId && filters.projectIds.includes(task.projectId))) return false;
  if (filters.teamIds.length && !(task.teamIds ?? []).some((id) => filters.teamIds.includes(id))) return false;
  if (filters.taskTypes.length) {
    const type = task.recurrence ? "recurring" : "mission";
    if (!filters.taskTypes.includes(type)) return false;
  }
  if (filters.myTasksOnly && !task.assigneeIds.includes(filters.currentUserId)) return false;
  const search = filters.search.trim().toLowerCase();
  if (search) {
    const haystack = [task.title, task.description, ...task.assigneeIds.map((id) => assigneeNameById[id] ?? "")].join(" ").toLowerCase();
    if (!haystack.includes(search)) return false;
  }
  return true;
}

export function filterTasks(tasks: Task[], filters: TaskFilters, assigneeNameById: Record<string, string>): Task[] {
  return tasks.filter((task) => taskMatchesFilters(task, filters, assigneeNameById));
}

export function sortTasks(tasks: Task[], field: SortField, direction: SortDirection, statusOrder: string[], priorityOrder: string[]): Task[] {
  const sorted = [...tasks].sort((a, b) => {
    let result = 0;
    switch (field) {
      case "manual":
        result = a.order - b.order;
        break;
      case "title":
        result = a.title.localeCompare(b.title);
        break;
      case "status":
        result = statusOrder.indexOf(a.status) - statusOrder.indexOf(b.status);
        break;
      case "priority":
        result = priorityOrder.indexOf(a.priority) - priorityOrder.indexOf(b.priority);
        break;
      case "dueDate":
        if (!a.dueDate && !b.dueDate) result = 0;
        else if (!a.dueDate) result = Infinity;
        else if (!b.dueDate) result = -Infinity;
        else result = toCasablancaDateInputValue(a.dueDate).localeCompare(toCasablancaDateInputValue(b.dueDate));
        break;
      case "createdAt":
        result = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        break;
    }
    return direction === "asc" ? result : -result;
  });
  return sorted;
}

export interface TaskGroupResult {
  key: string;
  label: string;
  tasks: Task[];
}

export function groupTasks(tasks: Task[], field: GroupField, assignees: Assignee[], statuses: StatusDef[], priorities: PriorityDef[]): TaskGroupResult[] {
  if (field === "status") {
    return statuses
      .map((status) => ({ key: status.id, label: status.label, tasks: tasks.filter((t) => t.status === status.id) }))
      .filter((group) => group.tasks.length > 0);
  }
  if (field === "priority") {
    return priorities
      .map((priority) => ({ key: priority.id, label: priority.label, tasks: tasks.filter((t) => t.priority === priority.id) }))
      .filter((group) => group.tasks.length > 0);
  }
  if (field === "assignee") {
    const byAssignee = assignees.map((assignee) => ({
      key: assignee.id,
      label: assignee.name,
      tasks: tasks.filter((t) => t.assigneeIds.includes(assignee.id)),
    }));
    const unassigned = { key: "unassigned", label: "Unassigned", tasks: tasks.filter((t) => t.assigneeIds.length === 0) };
    return [...byAssignee, unassigned].filter((group) => group.tasks.length > 0);
  }
  return [{ key: "all", label: "All tasks", tasks }];
}

export function computeOrderBetween(before: number | undefined, after: number | undefined): number {
  if (before === undefined && after === undefined) return 0;
  if (before === undefined) return (after as number) - 1;
  if (after === undefined) return before + 1;
  return (before + after) / 2;
}
