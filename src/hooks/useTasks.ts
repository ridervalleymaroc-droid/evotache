"use client";

import { useCallback, useRef, useEffect, useMemo } from "react";
import useSWR from "swr";
import { createTaskRequest, deleteTasksRequest, fetchTasks, updateTaskRequest } from "@/services/taskApi";
import { fetchStatuses, fetchPriorities } from "@/services/taskMetaApi";
import { fetchUsers } from "@/services/userApi";
import { generateId } from "@/lib/id";
import { useToast } from "@/components/ui/Toast";
import { useAuth } from "@/hooks/useAuth";
import { canManageUsers } from "@/config/roleMeta";
import { getDescendantIds } from "@/lib/taskTree";
import { computeNextOccurrence } from "@/lib/recurrence";
import { fromDateInputValue, isOverdue, toDateInputValue } from "@/lib/date";
import type { Assignee, Task, TaskDraft, TaskModule } from "@/types/task";
import type { AppUser } from "@/types/user";
import type { StatusDef, PriorityDef } from "@/types/taskMeta";

type LoadState = "loading" | "success" | "error";

export interface CreateTaskOptions {
  parentId?: string | null;
  status?: string;
  priority?: string;
  description?: string;
  dueDate?: string | null;
}

interface UseTasksResult {
  tasks: Task[];
  assignees: Assignee[];
  loadState: LoadState;
  errorMessage: string | null;
  refetch: () => void;
  createTask: (title: string, options?: CreateTaskOptions) => Promise<void>;
  updateTask: (id: string, patch: Partial<Task>) => Promise<void>;
  deleteTasks: (ids: string[]) => Promise<void>;
  reorderTask: (id: string, order: number) => Promise<void>;
  bulkSetParent: (ids: string[], parentId: string) => Promise<void>;
}

function taskKey(module: TaskModule) {
  return ["tasks", module] as const;
}

export function useTasks(module: TaskModule): UseTasksResult {
  const { user } = useAuth();
  const toast = useToast();
  const isAdmin = user ? canManageUsers(user.role) : false;
  const statusesRef = useRef<StatusDef[]>([]);

  // Shared cache keys — reused verbatim by useUsers/useTaskMeta, so mounting
  // both a task list and, say, the badge-count hook on the same page fetches
  // each of these exactly once instead of once per hook instance.
  const usersSWR = useSWR<AppUser[]>(user ? "users" : null, fetchUsers);
  const statusesSWR = useSWR<StatusDef[]>(user ? "statuses" : null, fetchStatuses);
  const prioritiesSWR = useSWR<PriorityDef[]>(user ? "priorities" : null, fetchPriorities);
  const tasksSWR = useSWR<Task[]>(user ? taskKey(module) : null, () => fetchTasks({ userId: user!.id, isAdmin, module, visibleUserIds: [] }));

  // A freshly spawned recurring task instance stays hidden until its due
  // date actually arrives — otherwise every occurrence would clutter To Do
  // the moment the previous one is completed, instead of surfacing when it's
  // actually actionable. Non-recurring tasks are unaffected.
  const tasks = useMemo(() => {
    const all = tasksSWR.data ?? [];
    const todayStr = toDateInputValue(new Date().toISOString());
    return all.filter((t) => !t.recurrence || !t.dueDate || toDateInputValue(t.dueDate) <= todayStr);
  }, [tasksSWR.data]);
  const statuses = useMemo(() => statusesSWR.data ?? [], [statusesSWR.data]);
  const priorities = useMemo(() => prioritiesSWR.data ?? [], [prioritiesSWR.data]);
  const assignees: Assignee[] = useMemo(
    () =>
      (usersSWR.data ?? [])
        .filter((u) => u.status === "active" && !u.isAgent)
        .map((u) => ({ id: u.id, name: u.name, color: u.color, photoDataUrl: u.photoDataUrl })),
    [usersSWR.data]
  );
  const defaultStatusId = statuses[0]?.id ?? "todo";
  const defaultPriorityId = priorities[priorities.length - 1]?.id ?? "none";

  const anyLoading = usersSWR.isLoading || statusesSWR.isLoading || prioritiesSWR.isLoading || tasksSWR.isLoading;
  const anyError = usersSWR.error || statusesSWR.error || prioritiesSWR.error || tasksSWR.error;
  const loadState: LoadState = anyError ? "error" : anyLoading ? "loading" : "success";
  const errorMessage = anyError ? (anyError instanceof Error ? anyError.message : "Something went wrong.") : null;

  const tasksRef = useRef<Task[]>(tasks);
  useEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);
  useEffect(() => {
    statusesRef.current = statuses;
  }, [statuses]);

  const refetch = useCallback(() => {
    void tasksSWR.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [module]);

  const createTask = useCallback(
    async (title: string, options: CreateTaskOptions = {}) => {
      const trimmed = title.trim();
      if (!trimmed || !user) return;
      const parentId = options.parentId ?? null;
      const previous = tasksRef.current;
      const id = generateId();
      const now = new Date().toISOString();
      const siblings = previous.filter((t) => t.parentId === parentId);
      const optimisticTask: Task = {
        id,
        module,
        title: trimmed,
        description: options.description ?? "",
        status: options.status ?? defaultStatusId,
        priority: options.priority ?? defaultPriorityId,
        assigneeIds: isAdmin ? [] : [user.id],
        teamIds: [],
        excludedUserIds: [],
        startDate: null,
        dueDate: options.dueDate ?? null,
        recurrence: null,
        parentId,
        projectId: null,
        customValues: {},
        createdBy: user.id,
        order: siblings.length ? Math.max(...siblings.map((t) => t.order)) + 1 : 0,
        createdAt: now,
        updatedAt: now,
      };
      await tasksSWR.mutate([...previous, optimisticTask], { revalidate: false });
      try {
        const draft: TaskDraft = { ...optimisticTask };
        const created = await createTaskRequest(draft);
        await tasksSWR.mutate((current) => (current ?? previous).map((t) => (t.id === id ? created : t)), { revalidate: false });
      } catch (err) {
        await tasksSWR.mutate(previous, { revalidate: false });
        toast.error(err instanceof Error ? err.message : "Failed to create task.");
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [toast, user, isAdmin, module, defaultStatusId, defaultPriorityId]
  );

  // Completing a recurring task spawns the next occurrence as a new task —
  // instead of recycling the same row (which loses history: it would never
  // actually show up among the Done tasks). The completed instance keeps its
  // own recurrence cleared, since the rule now lives on the new occurrence;
  // otherwise reopening it by mistake would spawn a duplicate.
  const spawnNextOccurrence = useCallback(
    async (source: Task) => {
      if (!source.recurrence) return;
      const base = source.dueDate ? new Date(source.dueDate) : new Date();
      const next = computeNextOccurrence(source.recurrence, base);
      const y = next.getFullYear();
      const m = String(next.getMonth() + 1).padStart(2, "0");
      const d = String(next.getDate()).padStart(2, "0");
      const firstId = statusesRef.current[0]?.id;
      if (!firstId) return;
      const siblings = tasksRef.current.filter((t) => t.parentId === source.parentId);
      const now = new Date().toISOString();
      const draft: TaskDraft = {
        id: generateId(),
        module: source.module,
        title: source.title,
        description: source.description,
        status: firstId,
        priority: source.priority,
        assigneeIds: source.assigneeIds,
        teamIds: source.teamIds,
        excludedUserIds: source.excludedUserIds,
        startDate: null,
        dueDate: fromDateInputValue(`${y}-${m}-${d}`),
        recurrence: source.recurrence,
        parentId: source.parentId,
        projectId: source.projectId,
        customValues: source.customValues,
        order: siblings.length ? Math.min(...siblings.map((t) => t.order)) - 1 : 0,
        createdAt: now,
        updatedAt: now,
      };
      try {
        const created = await createTaskRequest(draft, source.id);
        // Dedupe by id rather than blindly appending — a concurrent
        // revalidation of this same SWR key could otherwise already have
        // picked up the newly created row by the time this resolves,
        // leaving it listed twice.
        await tasksSWR.mutate(
          (current) => {
            const list = current ?? tasksRef.current;
            return list.some((t) => t.id === created.id) ? list : [...list, created];
          },
          { revalidate: false }
        );
        toast.success(`Next occurrence scheduled for ${next.toLocaleDateString(undefined, { month: "short", day: "numeric" })}.`);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to schedule the next occurrence.");
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [toast]
  );

  // A recurring task that goes overdue without being completed spawns its
  // next occurrence too — but unlike completion, the overdue instance itself
  // is left exactly as-is (still "todo", still showing its original date) so
  // it keeps surfacing as late. Its recurrence is cleared once the next
  // occurrence exists so it doesn't spawn again on every subsequent load.
  const overdueSpawnsInFlightRef = useRef<Set<string>>(new Set());
  const advanceOverdueOccurrence = useCallback(
    async (source: Task) => {
      if (!source.recurrence || !source.dueDate) return;
      const next = computeNextOccurrence(source.recurrence, new Date(source.dueDate));
      const y = next.getFullYear();
      const m = String(next.getMonth() + 1).padStart(2, "0");
      const d = String(next.getDate()).padStart(2, "0");
      const firstId = statusesRef.current[0]?.id;
      if (!firstId) return;
      const siblings = tasksRef.current.filter((t) => t.parentId === source.parentId);
      const now = new Date().toISOString();
      const draft: TaskDraft = {
        id: generateId(),
        module: source.module,
        title: source.title,
        description: source.description,
        status: firstId,
        priority: source.priority,
        assigneeIds: source.assigneeIds,
        teamIds: source.teamIds,
        excludedUserIds: source.excludedUserIds,
        startDate: null,
        dueDate: fromDateInputValue(`${y}-${m}-${d}`),
        recurrence: source.recurrence,
        parentId: source.parentId,
        projectId: source.projectId,
        customValues: source.customValues,
        order: siblings.length ? Math.min(...siblings.map((t) => t.order)) - 1 : 0,
        createdAt: now,
        updatedAt: now,
      };
      try {
        // Claim the spawn *before* creating anything: if a concurrent
        // session (another tab, another user viewing the same list) already
        // cleared this task's recurrence a moment earlier, recurrenceCleared
        // comes back false and this session must not also create a next
        // occurrence — that would leave two duplicate copies behind, one per
        // session that raced to advance the same overdue task.
        const clearResult = await updateTaskRequest(source.id, { recurrence: null });
        if (!clearResult.recurrenceCleared) return;
        const created = await createTaskRequest(draft, source.id);
        await tasksSWR.mutate(
          (current) => {
            const list = current ?? tasksRef.current;
            const withNext = list.some((t) => t.id === created.id) ? list : [...list, created];
            return withNext.map((t) => (t.id === source.id ? { ...t, recurrence: null } : t));
          },
          { revalidate: false }
        );
      } catch {
        // Best-effort: source.recurrence stays set on failure, so it's retried next time tasks load.
      } finally {
        overdueSpawnsInFlightRef.current.delete(source.id);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  useEffect(() => {
    const raw = tasksSWR.data;
    const currentStatuses = statusesRef.current;
    const doneId = currentStatuses[currentStatuses.length - 1]?.id;
    if (!raw || !doneId) return;
    for (const t of raw) {
      if (!t.recurrence || !t.dueDate || t.status === doneId || !isOverdue(t.dueDate)) continue;
      if (overdueSpawnsInFlightRef.current.has(t.id)) continue;
      overdueSpawnsInFlightRef.current.add(t.id);
      void advanceOverdueOccurrence(t);
    }
  }, [tasksSWR.data, statuses, advanceOverdueOccurrence]);

  const updateTask = useCallback(
    async (id: string, patch: Partial<Task>) => {
      const previous = tasksRef.current;
      const existingTask = previous.find((t) => t.id === id);
      let finalPatch = patch;

      const currentStatuses = statusesRef.current;
      const doneId = currentStatuses[currentStatuses.length - 1]?.id;
      const completesRecurrence =
        Boolean(existingTask?.recurrence) && Boolean(doneId) && patch.status === doneId && patch.status !== existingTask?.status;
      if (completesRecurrence) {
        finalPatch = { ...patch, recurrence: null };
      }

      // A task moved (back) to the workflow's first status ("To Do") jumps to
      // the front of the manual order, so it's easy to spot right after the change.
      const firstStatusId = statusesRef.current[0]?.id;
      if (firstStatusId && finalPatch.status === firstStatusId && existingTask && existingTask.status !== firstStatusId) {
        const minOrder = previous.length ? Math.min(...previous.map((t) => t.order)) : 0;
        finalPatch = { ...finalPatch, order: minOrder - 1 };
      }

      await tasksSWR.mutate(
        previous.map((t) => (t.id === id ? { ...t, ...finalPatch, updatedAt: new Date().toISOString() } : t)),
        { revalidate: false }
      );
      try {
        const updated = await updateTaskRequest(id, finalPatch);
        await tasksSWR.mutate((current) => (current ?? previous).map((t) => (t.id === id ? updated : t)), { revalidate: false });
        // updated.recurrenceCleared is false if a concurrent session already
        // cleared this task's recurrence first (e.g. someone else completed
        // it, or the overdue-auto-advance effect fired at the same moment)
        // — that session already spawned the next occurrence, so this one
        // must not spawn a duplicate.
        if (completesRecurrence && existingTask && updated.recurrenceCleared) await spawnNextOccurrence(existingTask);
      } catch (err) {
        await tasksSWR.mutate(previous, { revalidate: false });
        toast.error(err instanceof Error ? err.message : "Failed to update task.");
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [toast, spawnNextOccurrence]
  );

  const deleteTasks = useCallback(
    async (ids: string[]) => {
      const previous = tasksRef.current;
      const descendantIds = ids.flatMap((id) => getDescendantIds(previous, id));
      const allRemoved = new Set([...ids, ...descendantIds]);
      await tasksSWR.mutate(previous.filter((t) => !allRemoved.has(t.id)), { revalidate: false });
      try {
        await deleteTasksRequest(ids);
      } catch (err) {
        await tasksSWR.mutate(previous, { revalidate: false });
        toast.error(err instanceof Error ? err.message : "Failed to delete task.");
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [toast]
  );

  const reorderTask = useCallback(
    async (id: string, order: number) => {
      await updateTask(id, { order });
    },
    [updateTask]
  );

  const bulkSetParent = useCallback(
    async (ids: string[], parentId: string) => {
      const previous = tasksRef.current;
      const idSet = new Set(ids);
      const existingChildren = previous.filter((t) => t.parentId === parentId && !idSet.has(t.id));
      let nextOrder = existingChildren.length ? Math.max(...existingChildren.map((t) => t.order)) + 1 : 0;
      const patchById = new Map<string, Partial<Task>>();
      for (const id of ids) {
        patchById.set(id, { parentId, order: nextOrder });
        nextOrder += 1;
      }
      await tasksSWR.mutate(
        previous.map((t) => {
          const patch = patchById.get(t.id);
          return patch ? { ...t, ...patch, updatedAt: new Date().toISOString() } : t;
        }),
        { revalidate: false }
      );
      try {
        const updated = await Promise.all(ids.map((id) => updateTaskRequest(id, patchById.get(id) as Partial<Task>)));
        const updatedById = new Map(updated.map((t) => [t.id, t]));
        await tasksSWR.mutate((current) => (current ?? previous).map((t) => updatedById.get(t.id) ?? t), { revalidate: false });
      } catch (err) {
        await tasksSWR.mutate(previous, { revalidate: false });
        toast.error(err instanceof Error ? err.message : "Failed to move tasks.");
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [toast]
  );

  return { tasks, assignees, loadState, errorMessage, refetch, createTask, updateTask, deleteTasks, reorderTask, bulkSetParent };
}
