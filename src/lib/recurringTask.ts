import { Prisma, type PrismaClient, type Task as DbTask } from "@/generated/prisma/client";
import { computeNextOccurrence } from "@/lib/recurrence";
import type { RecurrenceRule, TaskDraft } from "@/types/task";

export class RecurrenceSourceUnavailableError extends Error {
  constructor() {
    super("Source task is no longer recurring.");
    this.name = "RecurrenceSourceUnavailableError";
  }
}

export class RecurrenceSourceNotFoundError extends Error {
  constructor() {
    super("Recurring source task not found.");
    this.name = "RecurrenceSourceNotFoundError";
  }
}

export interface CreateRecurringOccurrenceOptions {
  client: PrismaClient;
  draft: TaskDraft;
  sourceId: string;
  order: number;
  createdBy: string;
  completionStatus?: string;
}

export interface CreateRecurringOccurrenceResult {
  task: DbTask;
  created: boolean;
}

export async function createRecurringOccurrence({
  client,
  draft,
  sourceId,
  order,
  createdBy,
  completionStatus,
}: CreateRecurringOccurrenceOptions): Promise<CreateRecurringOccurrenceResult> {
  try {
    return await client.$transaction(async (tx) => {
      const existing = await tx.task.findUnique({ where: { recurrenceSourceId: sourceId } });
      if (existing) {
        await tx.task.update({
          where: { id: sourceId },
          data: {
            recurrence: Prisma.JsonNull,
            ...(completionStatus && { status: completionStatus }),
          },
        });
        return { task: existing, created: false };
      }

      const source = await tx.task.findUnique({
        where: { id: sourceId },
        select: { createdBy: true, dueDate: true, recurrence: true },
      });
      if (!source) throw new RecurrenceSourceNotFoundError();
      if (!source.recurrence) {
        const racedOccurrence = await tx.task.findUnique({ where: { recurrenceSourceId: sourceId } });
        if (racedOccurrence) {
          await tx.task.update({
            where: { id: sourceId },
            data: {
              recurrence: Prisma.JsonNull,
              ...(completionStatus && { status: completionStatus }),
            },
          });
          return { task: racedOccurrence, created: false };
        }
        throw new RecurrenceSourceUnavailableError();
      }

      const dueDate = computeNextOccurrence(source.recurrence as unknown as RecurrenceRule, source.dueDate ?? new Date());

      const task = await tx.task.create({
        data: {
          ...(draft.id && { id: draft.id }),
          recurrenceSourceId: sourceId,
          module: draft.module ?? "task",
          title: draft.title.trim(),
          description: draft.description ?? "",
          status: draft.status ?? "todo",
          priority: draft.priority ?? "none",
          assigneeIds: draft.assigneeIds ?? [],
          teamIds: draft.teamIds ?? [],
          excludedUserIds: draft.excludedUserIds ?? [],
          startDate: draft.startDate ? new Date(draft.startDate) : null,
          dueDate,
          recurrence: source.recurrence as Prisma.InputJsonValue,
          order,
          parentId: draft.parentId ?? null,
          projectId: draft.projectId ?? null,
          customValues: draft.customValues ?? {},
          createdBy: source.createdBy ?? createdBy,
        },
      });

      const cleared = await tx.task.updateMany({
        where: { id: sourceId, recurrence: { not: Prisma.JsonNull } },
        data: {
          recurrence: Prisma.JsonNull,
          ...(completionStatus && { status: completionStatus }),
        },
      });
      if (cleared.count === 0) {
        throw new RecurrenceSourceUnavailableError();
      }

      return { task, created: true };
    });
  } catch (error) {
    if (
      !(error instanceof RecurrenceSourceUnavailableError) &&
      !(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")
    ) {
      throw error;
    }

    const existing = await client.$transaction(async (tx) => {
      const task = await tx.task.findUnique({ where: { recurrenceSourceId: sourceId } });
      if (task) {
        await tx.task.update({
          where: { id: sourceId },
          data: {
            recurrence: Prisma.JsonNull,
            ...(completionStatus && { status: completionStatus }),
          },
        });
      }
      return task;
    });
    if (existing) return { task: existing, created: false };
    throw error;
  }
}
