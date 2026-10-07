import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { getVisibilityScope } from "@/lib/visibility";
import { toPublicTask } from "@/lib/publicTask";
import { notifyTaskAssignment } from "@/lib/taskNotify";
import { canCreateTasks } from "@/config/roleMeta";
import { Prisma } from "@/generated/prisma/client";
import type { Task as DbTask } from "@/generated/prisma/client";
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

  let createdBy = sessionUser.id;
  let recurrence: Prisma.InputJsonValue | undefined = (draft.recurrence as unknown as Prisma.InputJsonValue) ?? undefined;
  let recurrenceSourceId: string | undefined;
  if (draft.continuesTaskId) {
    const source = await db.task.findUnique({
      where: { id: draft.continuesTaskId },
      select: { createdBy: true, dueDate: true, recurrence: true },
    });
    if (!source) return NextResponse.json({ error: "Recurring source task not found." }, { status: 404 });
    if (!source.recurrence) return NextResponse.json({ error: "Source task is not recurring." }, { status: 400 });

    const sourceDueDate = source.dueDate;
    const nextDueDate = draft.dueDate ? new Date(draft.dueDate) : null;
    if (!sourceDueDate || !nextDueDate || Number.isNaN(nextDueDate.getTime()) || nextDueDate <= sourceDueDate) {
      return NextResponse.json({ error: "The next occurrence must have a due date after the source task." }, { status: 400 });
    }

    if (source.createdBy) createdBy = source.createdBy;
    recurrence = source.recurrence as Prisma.InputJsonValue;
    recurrenceSourceId = draft.continuesTaskId;
  }

  const data = {
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
    recurrence,
    ...(recurrenceSourceId && { recurrenceSourceId }),
    order,
    parentId: draft.parentId ?? null,
    projectId: draft.projectId ?? null,
    customValues: draft.customValues ?? {},
    createdBy,
  } satisfies Prisma.TaskUncheckedCreateInput;

  let task: DbTask;
  if (recurrenceSourceId) {
    try {
      task = await db.task.upsert({
        where: { recurrenceSourceId },
        create: data,
        update: {},
      });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
      const existing = await db.task.findUnique({ where: { recurrenceSourceId } });
      if (!existing) throw error;
      task = existing;
    }
  } else {
    task = await db.task.create({ data });
  }

  void notifyTaskAssignment(task.assigneeIds, task);

  return NextResponse.json(toPublicTask(task), { status: recurrenceSourceId ? 200 : 201 });
}
