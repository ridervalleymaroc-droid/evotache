-- AlterTable
ALTER TABLE "tasks" ADD COLUMN "recurrenceSourceId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "tasks_recurrenceSourceId_key" ON "tasks"("recurrenceSourceId");

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_recurrenceSourceId_fkey"
FOREIGN KEY ("recurrenceSourceId") REFERENCES "tasks"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
