import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

test(
  "concurrent recurrence creation returns one occurrence for a source task",
  { skip: !testDatabaseUrl && "Set TEST_DATABASE_URL to a dedicated migrated test database." },
  async () => {
    const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: testDatabaseUrl! }) });
    const sourceId = `test-source-${randomUUID()}`;
    const occurrenceIds = [`test-next-${randomUUID()}`, `test-next-${randomUUID()}`];

    try {
      await prisma.task.create({
        data: {
          id: sourceId,
          module: "task",
          title: "Concurrent recurrence test",
          status: "todo",
          priority: "none",
          order: 0,
          dueDate: new Date("2026-10-06T00:00:00.000Z"),
          recurrence: { frequency: "weekly", interval: 1, daysOfWeek: [1, 2, 3, 4, 5, 6], dayOfMonth: null },
        },
      });

      const createOccurrence = (id: string) =>
        prisma.task.upsert({
          where: { recurrenceSourceId: sourceId },
          create: {
            id,
            recurrenceSourceId: sourceId,
            module: "task",
            title: "Concurrent recurrence test",
            status: "todo",
            priority: "none",
            order: 0,
            dueDate: new Date("2026-10-07T00:00:00.000Z"),
            recurrence: { frequency: "weekly", interval: 1, daysOfWeek: [1, 2, 3, 4, 5, 6], dayOfMonth: null },
          },
          update: {},
        });

      const [first, second] = await Promise.all(occurrenceIds.map(createOccurrence));

      assert.equal(first.id, second.id);
      assert.equal(
        await prisma.task.count({ where: { recurrenceSourceId: sourceId } }),
        1
      );
    } finally {
      await prisma.task.deleteMany({ where: { id: { in: [sourceId, ...occurrenceIds] } } });
      await prisma.$disconnect();
    }
  }
);
