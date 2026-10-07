-- Review-only query: lists exact-content recurring task rows that occur more
-- than once. Inspect these results manually before authorizing any deletion.
WITH duplicate_groups AS (
  SELECT
    "module",
    "title",
    "description",
    "status",
    "priority",
    "assigneeIds",
    "teamIds",
    "excludedUserIds",
    "startDate",
    "dueDate",
    "recurrence",
    "parentId",
    "projectId",
    "customValues",
    "createdBy",
    COUNT(*) AS duplicate_count
  FROM "tasks"
  WHERE "recurrence" IS NOT NULL
    AND "dueDate" IS NOT NULL
  GROUP BY
    "module",
    "title",
    "description",
    "status",
    "priority",
    "assigneeIds",
    "teamIds",
    "excludedUserIds",
    "startDate",
    "dueDate",
    "recurrence",
    "parentId",
    "projectId",
    "customValues",
    "createdBy"
  HAVING COUNT(*) > 1
)
SELECT
  t."id",
  duplicate_groups.duplicate_count,
  t."module",
  t."title",
  t."dueDate",
  t."recurrence",
  t."parentId",
  t."createdBy",
  t."createdAt",
  t."updatedAt"
FROM "tasks" AS t
JOIN duplicate_groups
  ON t."module" = duplicate_groups."module"
  AND t."title" = duplicate_groups."title"
  AND t."description" = duplicate_groups."description"
  AND t."status" = duplicate_groups."status"
  AND t."priority" = duplicate_groups."priority"
  AND t."assigneeIds" = duplicate_groups."assigneeIds"
  AND t."teamIds" = duplicate_groups."teamIds"
  AND t."excludedUserIds" = duplicate_groups."excludedUserIds"
  AND t."startDate" IS NOT DISTINCT FROM duplicate_groups."startDate"
  AND t."dueDate" = duplicate_groups."dueDate"
  AND t."recurrence" = duplicate_groups."recurrence"
  AND t."parentId" IS NOT DISTINCT FROM duplicate_groups."parentId"
  AND t."projectId" IS NOT DISTINCT FROM duplicate_groups."projectId"
  AND t."customValues" = duplicate_groups."customValues"
  AND t."createdBy" IS NOT DISTINCT FROM duplicate_groups."createdBy"
ORDER BY t."dueDate", t."title", t."createdAt", t."id";
