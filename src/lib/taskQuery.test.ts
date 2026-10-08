import assert from "node:assert/strict";
import { test } from "node:test";
import { sortTasks } from "./taskQuery";
import type { Task } from "@/types/task";

function task(id: string, dueDate: string): Task {
  return {
    id,
    module: "task",
    title: id,
    description: "",
    status: "todo",
    priority: "normal",
    assigneeIds: [],
    teamIds: [],
    excludedUserIds: [],
    startDate: null,
    dueDate,
    recurrence: null,
    order: 0,
    parentId: null,
    projectId: null,
    customValues: {},
    createdBy: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

test("due-date sorting compares Casablanca calendar days", () => {
  const tasks = [
    task("first-october-9", "2026-10-08T23:00:00.000Z"),
    task("also-october-9", "2026-10-09T00:30:00.000Z"),
    task("october-10", "2026-10-09T23:00:00.000Z"),
  ];

  assert.deepEqual(
    sortTasks(tasks, "dueDate", "asc", [], []).map(({ id }) => id),
    ["first-october-9", "also-october-9", "october-10"],
  );
});
