import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { getVisibilityScope } from "@/lib/visibility";
import { toPublicTask } from "@/lib/publicTask";
import { notifyTaskAssignment } from "@/lib/taskNotify";
import { canCreateTasks } from "@/config/roleMeta";
import type { Prisma } from "@/generated/prisma/client";
import type { TaskDraft, TaskModule } from "@/types/task";

export async function GET(request: NextRequest) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const taskModule = request.nextUrl.searchParams.get("module") as TaskModule | null;
  if (taskModule !== "task" && taskModule !== "dispute") {
    return NextResponse.json({ error: "A valid module query param is required." }, { status: 400 });
  }

  const scope = await getVisibilityScope(sessionUser);
  const tasks = await db.task.findMany({ where: { module: taskModule }, orderBy: { order: "asc" } });
  if (scope.isAdmin) return NextResponse.json(tasks.map(toPublicTask));

  const visible = tasks.filter(
    (t) => t.assigneeIds.some((id) => scope.visibleUserIds.includes(id)) && !t.excludedUserIds.includes(scope.userId)
  );
  return NextResponse.json(visible.map(toPublicTask));
}

export async function POST(request: NextRequest) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canCreateTasks(sessionUser.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let draft: TaskDraft & { continuesTaskId?: string };
  try {
    draft = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  if (!draft.title?.trim()) return NextResponse.json({ error: "Title is required." }, { status: 400 });

  let order = draft.order;
  if (order === undefined) {
    const maxOrder = await db.task.aggregate({ where: { module: draft.module ?? "task" }, _max: { order: true } });
    order = (maxOrder._max.order ?? -1) + 1;
  }

  // Ownership is never taken from the client body — either it's a fresh
  // manual creation (owned by whoever's making the request), or it's the
  // next occurrence of a recurring task, which inherits the original
  // series' owner so permissions don't shift to whichever browser happened
  // to be open when the occurrence was spawned.
  let createdBy = sessionUser.id;
  if (draft.continuesTaskId) {
    const source = await db.task.findUnique({ where: { id: draft.continuesTaskId }, select: { createdBy: true } });
    if (source?.createdBy) createdBy = source.createdBy;
  }

  const task = await db.task.create({
    data: {
      ...(draft.id && { id: draft.id }),
      module: draft.module ?? "task",
      title: draft.title.trim(),
      description: draft.description ?? "",
      status: draft.status ?? "todo",
      priority: draft.priority ?? "none",
      assigneeIds: draft.assigneeIds ?? [],
      teamIds: draft.teamIds ?? [],
      excludedUserIds: draft.excludedUserIds ?? [],
      startDate: draft.startDate ? new Date(draft.startDate) : null,
      dueDate: draft.dueDate ? new Date(draft.dueDate) : null,
      recurrence: (draft.recurrence as unknown as Prisma.InputJsonValue) ?? undefined,
      order,
      parentId: draft.parentId ?? null,
      projectId: draft.projectId ?? null,
      customValues: draft.customValues ?? {},
      createdBy,
    },
  });

  void notifyTaskAssignment(task.assigneeIds, task);

  return NextResponse.json(toPublicTask(task), { status: 201 });
}
