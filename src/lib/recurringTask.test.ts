import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import type { TaskDraft } from "@/types/task";
import { createRecurringOccurrence } from "./recurringTask";
import { isRecurringCompletion } from "./recurrence";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const recurrence = { frequency: "weekly", interval: 1, daysOfWeek: [1, 2, 3, 4, 5, 6], dayOfMonth: null };

async function withSourceTask(run: (client: PrismaClient, sourceId: string) => Promise<void>) {
  const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: testDatabaseUrl! }) });
  const sourceId = `test-source-${randomUUID()}`;
  try {
    await client.task.create({
      data: {
        id: sourceId,
        module: "task",
        title: "Recurring transaction test",
        status: "todo",
        priority: "none",
        order: 0,
        dueDate: new Date("2026-10-06T00:00:00.000Z"),
        recurrence,
      },
    });
    await run(client, sourceId);
  } finally {
    await client.task.deleteMany({ where: { id: sourceId } });
    await client.$disconnect();
  }
}

function makeDraft(id: string, parentId: string | null = null): TaskDraft {
  return {
    id,
    module: "task",
    title: "Recurring transaction test",
    status: "todo",
    priority: "none",
    dueDate: "2026-10-07T00:00:00.000Z",
    recurrence: null,
    parentId,
    order: 0,
  };
}

test(
  "recurrence creation and source-rule clearing roll back together on create failure",
  { skip: !testDatabaseUrl && "Set TEST_DATABASE_URL to a dedicated migrated test database." },
  async () => {
    await withSourceTask(async (client, sourceId) => {
      await assert.rejects(
        createRecurringOccurrence({
          client,
          draft: makeDraft(`test-next-${randomUUID()}`, `missing-parent-${randomUUID()}`),
          sourceId,
          order: 0,
          createdBy: "test-user",
        })
      );

      const source = await client.task.findUniqueOrThrow({ where: { id: sourceId } });
      assert.deepEqual(source.recurrence, recurrence);
      assert.equal(await client.task.count({ where: { recurrenceSourceId: sourceId } }), 0);
    });
  }
);

test(
  "Done followed by opening the next day reuses exactly one successor",
  { skip: !testDatabaseUrl && "Set TEST_DATABASE_URL to a dedicated migrated test database." },
  async () => {
    await withSourceTask(async (client, sourceId) => {
      const draft = makeDraft(`test-next-${randomUUID()}`);
      const options = { client, draft, sourceId, order: 0, createdBy: "test-user" };
      const first = await createRecurringOccurrence({ ...options, completionStatus: "done" });
      const reopenedNextDay = await createRecurringOccurrence(options);

      assert.equal(first.created, true);
      assert.equal(reopenedNextDay.created, false);
      assert.equal(reopenedNextDay.task.id, first.task.id);
      assert.equal(first.task.dueDate?.toISOString(), "2026-10-06T23:00:00.000Z");
      assert.equal(await client.task.count({ where: { recurrenceSourceId: sourceId } }), 1);
      const source = await client.task.findUniqueOrThrow({ where: { id: sourceId } });
      assert.equal(source.status, "done");
      assert.equal(source.recurrence, null);
      assert.equal(isRecurringCompletion(null, source.status, "done", "done"), false);
    });
  }
);

test(
  "concurrent recurring-creation requests create a single successor",
  { skip: !testDatabaseUrl && "Set TEST_DATABASE_URL to a dedicated migrated test database." },
  async () => {
    await withSourceTask(async (client, sourceId) => {
      const results = await Promise.all(
        [randomUUID(), randomUUID()].map((id) =>
          createRecurringOccurrence({
            client,
            draft: makeDraft(`test-next-${id}`),
            sourceId,
            order: 0,
            createdBy: "test-user",
          })
        )
      );

      assert.equal(results[0].task.id, results[1].task.id);
      assert.equal(await client.task.count({ where: { recurrenceSourceId: sourceId } }), 1);
    });
  }
);
