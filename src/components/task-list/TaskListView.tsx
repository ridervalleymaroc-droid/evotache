"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTasks } from "@/hooks/useTasks";
import { useAuth } from "@/hooks/useAuth";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useTaskMeta } from "@/hooks/useTaskMeta";
import { useCustomFields } from "@/hooks/useCustomFields";
import { useViewPrefs } from "@/hooks/useViewPrefs";
import { usePagination } from "@/hooks/usePagination";
import { useProjects } from "@/hooks/useProjects";
import { useTeams } from "@/hooks/useTeams";
import { Pagination } from "@/components/ui/Pagination";
import { getTaskPermissions } from "@/lib/taskPermissions";
import { canManageWorkflow } from "@/config/roleMeta";
import { TaskListToolbar } from "./TaskListToolbar";
import type { TaskViewMode } from "./TaskListToolbar";
import { TaskTable } from "./TaskTable";
import type { TaskTableGroup } from "./TaskTable";
import { TaskCardList } from "./TaskCardList";
import { BoardView } from "./BoardView";
import { TaskListSkeleton } from "./TaskListSkeleton";
import { EmptyState } from "./EmptyState";
import { ErrorState } from "./ErrorState";
import { TaskDetailDrawer } from "./TaskDetailDrawer";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { groupTasks, sortTasks } from "@/lib/taskQuery";
import { collectVisibleTasks, countDescendants, filterTopLevelTasks, flattenGroupTree, flattenVisibleTree, getChildren, getDescendantIds } from "@/lib/taskTree";
import { fetchAttachmentCountsByTask } from "@/services/attachmentApi";
import type { GroupField, SortDirection, SortField, Task, TaskFilters, TaskModule, TaskTypeFilter } from "@/types/task";

interface TaskListViewProps {
  module: TaskModule;
  title: string;
  subtitle: string;
}

export function TaskListView({ module, title, subtitle }: TaskListViewProps) {
  const { user } = useAuth();
  const permissions = getTaskPermissions(user ?? undefined);
  const { tasks, assignees, loadState, errorMessage, refetch, createTask, updateTask, deleteTasks, reorderTask, bulkSetParent } = useTasks(module);
  const { statuses, priorities, loadState: metaLoadState } = useTaskMeta();
  const { fields: customFields, addField, editField, removeField } = useCustomFields();
  const canManageFields = user ? canManageWorkflow(user.role) : false;
  const { hiddenColumnIds, toggleColumn, columnWidths, setColumnWidth, columnOrder, reorderColumns, pageSize, setPageSize } = useViewPrefs();
  const { projects } = useProjects();
  const { teams } = useTeams();
  const searchParams = useSearchParams();

  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 200);
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [priorityFilter, setPriorityFilter] = useState<string[]>([]);
  const [assigneeFilter, setAssigneeFilter] = useState<string[]>([]);
  const [projectFilter, setProjectFilter] = useState<string[]>(() => {
    const projectParam = searchParams.get("project");
    return projectParam ? [projectParam] : [];
  });
  const [teamFilter, setTeamFilter] = useState<string[]>(() => {
    const teamParam = searchParams.get("team");
    return teamParam ? [teamParam] : [];
  });
  const [taskTypeFilter, setTaskTypeFilter] = useState<TaskTypeFilter[]>([]);
  const [myTasksOnly, setMyTasksOnly] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const [viewMode, setViewMode] = useState<TaskViewMode>("list");
  const [groupField, setGroupField] = useState<GroupField>("status");
  const [sortField, setSortField] = useState<SortField>("manual");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());
  const [pendingDeleteIds, setPendingDeleteIds] = useState<string[] | null>(null);
  const [detailTask, setDetailTask] = useState<Task | null>(null);
  const [attachmentCounts, setAttachmentCounts] = useState<Record<string, number>>({});
  const [attachmentRefreshKey, setAttachmentRefreshKey] = useState(0);

  const assigneeNameById = useMemo(() => Object.fromEntries(assignees.map((a) => [a.id, a.name])), [assignees]);
  const allTasksById = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);

  // Candidate parents for the "move under…" bulk action — everything except
  // the selected tasks themselves and their own descendants, since either
  // would create a cycle.
  const parentCandidates = useMemo(() => {
    if (selectedIds.size === 0) return [];
    const blocked = new Set(selectedIds);
    for (const id of selectedIds) {
      for (const descendantId of getDescendantIds(tasks, id)) blocked.add(descendantId);
    }
    return tasks.filter((t) => !blocked.has(t.id)).map((t) => ({ id: t.id, title: t.title }));
  }, [tasks, selectedIds]);

  async function handleBulkSetParent(parentId: string) {
    await bulkSetParent(Array.from(selectedIds), parentId);
    setSelectedIds(new Set());
  }

  useEffect(() => {
    let cancelled = false;
    fetchAttachmentCountsByTask().then((counts) => {
      if (!cancelled) setAttachmentCounts(counts);
    });
    return () => {
      cancelled = true;
    };
  }, [tasks, attachmentRefreshKey]);

  const hasActiveFilters = Boolean(
    debouncedSearch ||
      statusFilter.length ||
      priorityFilter.length ||
      assigneeFilter.length ||
      projectFilter.length ||
      teamFilter.length ||
      taskTypeFilter.length ||
      myTasksOnly ||
      showDone
  );

  // The last status is treated as "done" throughout this app (same idiom
  // as doneStatusId() in agent/tools.ts, useOverdueNotifications.ts, etc.)
  // — hidden from the list view by default so completed work doesn't
  // clutter it, unless the user explicitly picked "Done" via the Status
  // filter (that explicit choice wins over the default hide) or toggled
  // "Show done". Board view is deliberately unaffected (see boardTasks) —
  // a kanban's whole point is showing every column, done included.
  //
  // This can't be done by feeding an "everything but done" whitelist into
  // TaskFilters.statuses the way every other filter works: filterTopLevelTasks
  // deliberately shows a task's *whole* subtree once any part of it matches
  // (so subtask context isn't lost while searching/filtering) — which means
  // a done subtask would still tag along under its visible non-done parent,
  // confirmed live (a done subtask kept showing even with "Show done" off).
  // Hiding done needs to prune at every depth instead, so it's applied as a
  // separate pass below, after the normal tree-preserving filters.
  const doneStatusId = statuses.find((status) => status.id === "done")?.id ?? null;
  const shouldHideDone = doneStatusId !== null && !showDone && !statusFilter.includes(doneStatusId);

  const groups: TaskTableGroup[] = useMemo(() => {
    const filters: TaskFilters = {
      search: debouncedSearch,
      statuses: statusFilter,
      priorities: priorityFilter,
      assigneeIds: assigneeFilter,
      projectIds: projectFilter,
      teamIds: teamFilter,
      taskTypes: taskTypeFilter,
      myTasksOnly,
      currentUserId: user?.id ?? "",
    };
    const taskIds = new Set(tasks.map((task) => task.id));
    const topLevel = tasks.filter((task) => task.parentId === null || !taskIds.has(task.parentId));
    const filteredTopLevel = filterTopLevelTasks(topLevel, tasks, filters, assigneeNameById);
    const statusOrder = statuses.map((s) => s.id);
    const priorityOrder = priorities.map((p) => p.id);

    let result: TaskTableGroup[];
    if (groupField === "none") {
      const sortedTopLevel = sortTasks(filteredTopLevel, sortField, sortDirection, statusOrder, priorityOrder);
      result = [{ key: "all", label: "All tasks", rows: flattenVisibleTree(sortedTopLevel, tasks, collapsedIds) }];
    } else {
      // Grouped views bucket every visible task (not just roots) by its own
      // status/priority/assignee, so a subtask moves into its own group
      // instead of staying stuck wherever its parent landed.
      const visibleTasks = collectVisibleTasks(filteredTopLevel, tasks);
      const groupResults = groupTasks(visibleTasks, groupField, assignees, statuses, priorities);
      result = groupResults.map((group) => ({
        key: group.key,
        label: group.label,
        rows: flattenGroupTree(sortTasks(group.tasks, sortField, sortDirection, statusOrder, priorityOrder), collapsedIds),
      }));
    }

    if (shouldHideDone) {
      result = result.map((g) => ({ ...g, rows: g.rows.filter((r) => r.task.status !== doneStatusId) })).filter((g) => g.rows.length > 0);
    }
    // filterTopLevelTasks keeps a matching task's whole subtree visible for
    // context (so you can still see a matched task's subtasks) — but that
    // means a subtask with a *different* status than the active status
    // filter stays in the list too, and then lands in its own status
    // group/column. Prune those out here so "Todo" never shows an
    // "In Progress" row/column just because it's a subtask of a Todo task.
    if (statusFilter.length) {
      result = result.map((g) => ({ ...g, rows: g.rows.filter((r) => statusFilter.includes(r.task.status)) })).filter((g) => g.rows.length > 0);
    }
    return result;
  }, [
    tasks,
    debouncedSearch,
    statusFilter,
    priorityFilter,
    assigneeFilter,
    projectFilter,
    teamFilter,
    taskTypeFilter,
    myTasksOnly,
    user,
    assigneeNameById,
    sortField,
    sortDirection,
    groupField,
    assignees,
    statuses,
    priorities,
    collapsedIds,
    shouldHideDone,
    doneStatusId,
  ]);

  const boardTasks = useMemo(() => {
    const filters: TaskFilters = {
      search: debouncedSearch,
      statuses: statusFilter,
      priorities: priorityFilter,
      assigneeIds: assigneeFilter,
      projectIds: projectFilter,
      teamIds: teamFilter,
      taskTypes: taskTypeFilter,
      myTasksOnly,
      currentUserId: user?.id ?? "",
    };
    const taskIds = new Set(tasks.map((task) => task.id));
    const topLevel = tasks.filter((task) => task.parentId === null || !taskIds.has(task.parentId));
    const filteredTopLevel = filterTopLevelTasks(topLevel, tasks, filters, assigneeNameById);
    const visible = flattenVisibleTree(filteredTopLevel, tasks, new Set()).map((row) => row.task);
    // Same subtree-leak fix as the list/grouped view above — a subtask with
    // a different status than the active filter would otherwise still show
    // up in its own board column.
    return statusFilter.length ? visible.filter((t) => statusFilter.includes(t.status)) : visible;
  }, [tasks, debouncedSearch, statusFilter, priorityFilter, assigneeFilter, projectFilter, teamFilter, taskTypeFilter, myTasksOnly, user, assigneeNameById]);

  const allRowIds = useMemo(() => groups.flatMap((g) => g.rows.map((r) => r.task.id)), [groups]);
  const totalRows = allRowIds.length;

  const flatRows = useMemo(() => groups.flatMap((g) => g.rows), [groups]);
  const { page: rawPage, setPage, pageCount } = usePagination(flatRows.length, pageSize);
  // Render-time reset (no effect): jump back to page 1 whenever the result
  // set itself changes shape, so pagination never strands the user on a
  // page number that no longer corresponds to their filters/sort/grouping.
  const filterSignature = JSON.stringify([
    debouncedSearch,
    statusFilter,
    priorityFilter,
    assigneeFilter,
    projectFilter,
    teamFilter,
    taskTypeFilter,
    myTasksOnly,
    showDone,
    sortField,
    sortDirection,
    groupField,
  ]);
  const [lastFilterSignature, setLastFilterSignature] = useState(filterSignature);
  const filtersChanged = filterSignature !== lastFilterSignature;
  if (filtersChanged) {
    setLastFilterSignature(filterSignature);
    setPage(1);
  }
  const page = filtersChanged ? 1 : rawPage;
  const pageStart = pageSize === "all" ? 0 : (page - 1) * pageSize;
  const pageEnd = pageSize === "all" ? flatRows.length : Math.min(pageStart + pageSize, flatRows.length);

  const pagedGroups: TaskTableGroup[] = useMemo(() => {
    const pageIds = new Set(flatRows.slice(pageStart, pageEnd).map((r) => r.task.id));
    return groups.map((g) => ({ ...g, rows: g.rows.filter((r) => pageIds.has(r.task.id)) })).filter((g) => g.rows.length > 0);
  }, [groups, flatRows, pageStart, pageEnd]);

  // Union of the user's own "Columns" toggle and any columns an admin has
  // hidden for them — the admin restriction can never be re-enabled by the
  // user's own self-service preference.
  const effectiveHiddenColumnIds = useMemo(
    () => Array.from(new Set([...hiddenColumnIds, ...(user?.hiddenColumnIds ?? [])])),
    [hiddenColumnIds, user]
  );
  const visibleColumns = useMemo(
    () => ({
      assignees: !effectiveHiddenColumnIds.includes("assignees"),
      team: !effectiveHiddenColumnIds.includes("team"),
      dueDate: !effectiveHiddenColumnIds.includes("dueDate"),
      priority: !effectiveHiddenColumnIds.includes("priority"),
      status: !effectiveHiddenColumnIds.includes("status"),
    }),
    [effectiveHiddenColumnIds]
  );
  const visibleCustomFields = useMemo(
    () => customFields.filter((f) => !effectiveHiddenColumnIds.includes(f.id)),
    [customFields, effectiveHiddenColumnIds]
  );

  function toggleSelect(id: string, checked: boolean) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function toggleSelectAll(checked: boolean) {
    setSelectedIds(checked ? new Set(allRowIds) : new Set());
  }

  function toggleCollapse(id: string) {
    setCollapsedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function clearFilters() {
    setSearch("");
    setStatusFilter([]);
    setPriorityFilter([]);
    setAssigneeFilter([]);
    setProjectFilter([]);
    setTeamFilter([]);
    setTaskTypeFilter([]);
    setMyTasksOnly(false);
    setShowDone(false);
  }

  function handleAddSubtask(parentId: string) {
    setCollapsedIds((current) => {
      if (!current.has(parentId)) return current;
      const next = new Set(current);
      next.delete(parentId);
      return next;
    });
    createTask("New subtask", { parentId });
  }

  function handleCloseDetail() {
    setDetailTask(null);
    setAttachmentRefreshKey((k) => k + 1);
  }

  async function handleConfirmDelete() {
    if (!pendingDeleteIds) return;
    const ids = pendingDeleteIds;
    await deleteTasks(ids);
    setSelectedIds((current) => {
      const next = new Set(current);
      ids.forEach((id) => next.delete(id));
      return next;
    });
    if (detailTask && ids.includes(detailTask.id)) setDetailTask(null);
    setPendingDeleteIds(null);
  }

  const pendingDescendantCount = pendingDeleteIds ? pendingDeleteIds.reduce((sum, id) => sum + countDescendants(tasks, id), 0) : 0;
  const openTask = detailTask ? (allTasksById.get(detailTask.id) ?? detailTask) : null;
  const isLoading = loadState === "loading" || metaLoadState === "loading";
  const isReady = loadState === "success" && metaLoadState === "success";

  return (
    <div className="mx-auto flex w-full max-w-[95%] flex-col gap-4 px-4 py-8 sm:px-6 lg:px-8">
      <header className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-50">{title}</h1>
          {user && user.role !== "admin" && (
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400">
              {permissions.canCreate ? "Limited access" : "View only"}
            </span>
          )}
        </div>
        <p className="text-sm text-slate-500 dark:text-slate-400">{subtitle}</p>
      </header>

      <TaskListToolbar
        search={search}
        onSearchChange={setSearch}
        statusFilter={statusFilter}
        onStatusFilterChange={setStatusFilter}
        priorityFilter={priorityFilter}
        onPriorityFilterChange={setPriorityFilter}
        assigneeFilter={assigneeFilter}
        onAssigneeFilterChange={setAssigneeFilter}
        projectFilter={projectFilter}
        onProjectFilterChange={setProjectFilter}
        teamFilter={teamFilter}
        onTeamFilterChange={setTeamFilter}
        taskTypeFilter={taskTypeFilter}
        onTaskTypeFilterChange={setTaskTypeFilter}
        myTasksOnly={myTasksOnly}
        onMyTasksOnlyChange={setMyTasksOnly}
        showDone={showDone}
        onShowDoneChange={setShowDone}
        hasActiveFilters={hasActiveFilters}
        onClearFilters={clearFilters}
        assignees={assignees}
        projects={projects}
        teams={teams}
        statuses={statuses}
        priorities={priorities}
        customFields={customFields}
        hiddenColumnIds={hiddenColumnIds}
        onToggleColumn={toggleColumn}
        groupField={groupField}
        onGroupFieldChange={setGroupField}
        sortField={sortField}
        sortDirection={sortDirection}
        onSortFieldChange={setSortField}
        onToggleSortDirection={() => setSortDirection((d) => (d === "asc" ? "desc" : "asc"))}
        selectedCount={selectedIds.size}
        onBulkDelete={() => setPendingDeleteIds(Array.from(selectedIds))}
        onClearSelection={() => setSelectedIds(new Set())}
        parentCandidates={parentCandidates}
        onBulkSetParent={handleBulkSetParent}
        visibleCount={totalRows}
        totalCount={tasks.length}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
      />

      {isLoading && <TaskListSkeleton />}

      {loadState === "error" && <ErrorState message={errorMessage ?? "Unknown error."} onRetry={refetch} />}

      {isReady && totalRows === 0 && hasActiveFilters && <EmptyState onClearFilters={clearFilters} />}

      {isReady && (totalRows > 0 || !hasActiveFilters) && viewMode === "list" && (
        <>
          <TaskTable
            groups={pagedGroups}
            allTasksById={allTasksById}
            assignees={assignees}
            teams={teams}
            columnWidths={columnWidths}
            onResizeColumn={setColumnWidth}
            columnOrder={columnOrder}
            onReorderColumns={reorderColumns}
            statuses={statuses}
            priorities={priorities}
            visibleColumns={visibleColumns}
            visibleCustomFields={visibleCustomFields}
            canManageFields={canManageFields}
            onAddCustomField={addField}
            onRenameCustomField={(id, name) => editField(id, { name })}
            onSetCustomFieldOptions={(id, options) => editField(id, { options })}
            onDeleteCustomField={removeField}
            attachmentCounts={attachmentCounts}
            groupField={groupField}
            dragEnabled={sortField === "manual" && permissions.canEditStatus}
            permissions={permissions}
            selectedIds={selectedIds}
            collapsedIds={collapsedIds}
            onToggleSelect={toggleSelect}
            onToggleSelectAll={toggleSelectAll}
            onToggleCollapse={toggleCollapse}
            onUpdate={updateTask}
            onRequestDelete={(id) => setPendingDeleteIds([id])}
            onAddSubtask={handleAddSubtask}
            onOpenDetail={setDetailTask}
            onReorder={reorderTask}
            onCreate={createTask}
          />
          <TaskCardList
            groups={pagedGroups}
            assignees={assignees}
            teams={teams}
            statuses={statuses}
            priorities={priorities}
            visibleColumns={visibleColumns}
            attachmentCounts={attachmentCounts}
            groupField={groupField}
            permissions={permissions}
            selectedIds={selectedIds}
            collapsedIds={collapsedIds}
            onToggleSelect={toggleSelect}
            onToggleCollapse={toggleCollapse}
            onUpdate={updateTask}
            onRequestDelete={(id) => setPendingDeleteIds([id])}
            onAddSubtask={handleAddSubtask}
            onOpenDetail={setDetailTask}
            onCreate={createTask}
          />
          {totalRows > 0 && (
            <Pagination
              page={page}
              pageCount={pageCount}
              pageSize={pageSize}
              total={totalRows}
              rangeStart={pageStart + 1}
              rangeEnd={pageEnd}
              onPageChange={setPage}
              onPageSizeChange={(size) => {
                setPageSize(size);
                setPage(1);
              }}
            />
          )}
        </>
      )}

      {isReady && (totalRows > 0 || !hasActiveFilters) && viewMode === "board" && (
        <BoardView
          tasks={boardTasks}
          statuses={statuses}
          priorities={priorities}
          assignees={assignees}
          attachmentCounts={attachmentCounts}
          permissions={permissions}
          onUpdate={updateTask}
          onCreate={createTask}
          onOpenDetail={setDetailTask}
          onRequestDelete={(id) => setPendingDeleteIds([id])}
        />
      )}

      <TaskDetailDrawer
        task={openTask}
        assignees={assignees}
        statuses={statuses}
        priorities={priorities}
        customFields={customFields}
        projects={projects}
        teams={teams}
        subtaskCount={openTask ? getChildren(tasks, openTask.id).length : 0}
        currentUserId={user?.id ?? ""}
        permissions={permissions}
        onClose={handleCloseDetail}
        onUpdate={updateTask}
      />

      <ConfirmDialog
        open={pendingDeleteIds !== null}
        title={pendingDeleteIds && pendingDeleteIds.length > 1 ? `Delete ${pendingDeleteIds.length} tasks?` : "Delete task?"}
        description={
          pendingDescendantCount > 0
            ? `This will also delete ${pendingDescendantCount} subtask${pendingDescendantCount > 1 ? "s" : ""}. This action cannot be undone.`
            : "This action cannot be undone."
        }
        confirmLabel="Delete"
        destructive
        onConfirm={handleConfirmDelete}
        onCancel={() => setPendingDeleteIds(null)}
      />
    </div>
  );
}
