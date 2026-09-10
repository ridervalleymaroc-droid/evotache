import { db } from "@/lib/db";
import { isOverdue, isDueSoon } from "@/lib/date";

export interface DailyReportMetrics {
  openTasksCount: number;
  overdueCount: number;
  dueSoonCount: number;
  completedTodayCount: number;
  openDisputesCount: number;
  workloadByPerson: Array<{ name: string; color: string; count: number }>;
}

/**
 * Generate daily report metrics by querying the database.
 * Returns the same metrics displayed on the dashboard.
 */
export async function generateDailyReport(): Promise<DailyReportMetrics> {
  // Fetch all tasks
  const allTasks = await db.task.findMany({
    include: {
      project: true,
    },
  });

  // Fetch all users for workload calculation
  const users = await db.user.findMany({
    where: { status: "active" },
    select: { id: true, name: true, color: true },
  });

  // Get all statuses ordered by order, "done" is the last one
  const allStatuses = await db.statusDef.findMany({
    orderBy: { order: "asc" },
  });
  const doneStatusId = allStatuses[allStatuses.length - 1]?.id;

  // Calculate metrics
  const openTasks = allTasks.filter((t) => t.status !== doneStatusId);
  const disputes = allTasks.filter((t) => t.module === "dispute" && t.status !== doneStatusId);

  const overdueCount = openTasks.filter((t) => isOverdue(t.dueDate?.toISOString() ?? null)).length;
  const dueSoonCount = openTasks.filter((t) => isDueSoon(t.dueDate?.toISOString() ?? null)).length;

  // Tasks completed today
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const completedTodayCount = allTasks.filter((t) => {
    if (t.status !== doneStatusId) return false;
    const updatedDate = new Date(t.updatedAt);
    updatedDate.setHours(0, 0, 0, 0);
    return updatedDate.getTime() === today.getTime();
  }).length;

  // Workload per person (count of open tasks assigned to each user)
  const workloadByPerson = users
    .map((user) => {
      const count = openTasks.filter((t) => t.assigneeIds.includes(user.id)).length;
      return {
        name: user.name,
        color: user.color,
        count,
      };
    })
    .filter((item) => item.count > 0)
    .sort((a, b) => b.count - a.count);

  return {
    openTasksCount: openTasks.length,
    overdueCount,
    dueSoonCount,
    completedTodayCount,
    openDisputesCount: disputes.length,
    workloadByPerson,
  };
}

/**
 * Format metrics as HTML email body.
 */
export function formatReportAsHtml(metrics: DailyReportMetrics): string {
  const getStatusClass = (count: number, threshold: number = 0) => {
    if (count > threshold) return "style=\"color: #dc2626; font-weight: bold;\"";
    return "style=\"color: #059669;\"";
  };

  const workloadHtml =
    metrics.workloadByPerson.length > 0
      ? `
        <tr>
          <td style="padding: 12px; border: 1px solid #e5e7eb; background: #f9fafb;">
            <strong>Workload by person:</strong><br>
            ${metrics.workloadByPerson.map((item) => `<span style="display: inline-block; margin: 4px 8px 4px 0; padding: 4px 8px; background: ${item.color}22; border-left: 3px solid ${item.color}; border-radius: 4px;">${item.name}: <strong>${item.count}</strong> tasks</span>`).join("")}
          </td>
        </tr>
      `
      : "";

  return `
    <html>
      <head>
        <meta charset="UTF-8">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; color: #1f2937; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; background: #f3f4f6; }
          .header { background: #ffffff; padding: 20px; border-radius: 8px 8px 0 0; border-bottom: 3px solid #4f46e5; }
          .content { background: #ffffff; padding: 20px; border-radius: 0 0 8px 8px; }
          .metrics-table { width: 100%; border-collapse: collapse; margin-top: 16px; }
          .metrics-table td { padding: 12px; border: 1px solid #e5e7eb; background: #fafafa; }
          .metric-label { font-weight: 600; color: #374151; width: 40%; }
          .metric-value { text-align: right; font-size: 18px; color: #1f2937; }
          .footer { text-align: center; font-size: 12px; color: #6b7280; margin-top: 24px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1 style="margin: 0; color: #4f46e5; font-size: 24px;">📊 Daily Report</h1>
            <p style="margin: 8px 0 0 0; color: #6b7280; font-size: 14px;">${new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}</p>
          </div>
          <div class="content">
            <table class="metrics-table">
              <tr>
                <td class="metric-label">Open Tasks</td>
                <td class="metric-value" ${getStatusClass(metrics.openTasksCount)}>${metrics.openTasksCount}</td>
              </tr>
              <tr>
                <td class="metric-label">Overdue</td>
                <td class="metric-value" ${getStatusClass(metrics.overdueCount)}>${metrics.overdueCount}</td>
              </tr>
              <tr>
                <td class="metric-label">Due within 2 days</td>
                <td class="metric-value" ${getStatusClass(metrics.dueSoonCount)}>${metrics.dueSoonCount}</td>
              </tr>
              <tr>
                <td class="metric-label">Completed today</td>
                <td class="metric-value">${metrics.completedTodayCount}</td>
              </tr>
              <tr>
                <td class="metric-label">Open Disputes</td>
                <td class="metric-value" ${getStatusClass(metrics.openDisputesCount)}>${metrics.openDisputesCount}</td>
              </tr>
              ${workloadHtml}
            </table>
            <div class="footer">
              <p style="margin: 20px 0;">This report was sent automatically by EvoTasks.</p>
            </div>
          </div>
        </div>
      </body>
    </html>
  `;
}
