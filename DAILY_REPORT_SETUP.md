# Daily Report by Email — Setup Guide

## Overview

This feature sends an automated daily report via Gmail at 10:00 AM and 7:50 PM (UTC/Casablanca timezone).

The report includes:
- Number of open tasks
- Overdue tasks count
- Tasks due within 2 days
- Completed tasks (today)
- Open disputes count
- Workload per person

## Setup Steps

### 1. Configure Environment Variables

Add the following to your `.env.local` file:

```bash
# Email recipient for daily reports
REPORT_EMAIL_RECIPIENT="your-email@example.com"

# Secret key for authenticating Vercel Cron requests
# Generate a secure random value with: openssl rand -base64 32
REPORT_CRON_SECRET="your-secure-random-secret-here"
```

### 2. Enable the UI in Settings

1. Go to **Settings > Backup**
2. You'll see the new "Daily Report by Email" section
3. Enable the toggle
4. Enter the recipient email address (same as `REPORT_EMAIL_RECIPIENT`)
5. Click **Save**

### 3. Test the Setup

1. In the Settings > Backup section, click **Send Test Email**
2. A dialog will prompt for your `REPORT_CRON_SECRET` value
3. If successful, you'll receive an email confirmation

### 4. Deploy to Vercel

The `vercel.json` file defines two Cron Jobs:

```json
{
  "crons": [
    {
      "path": "/api/reports/send",
      "schedule": "0 10 * * *"    // 10:00 AM UTC daily
    },
    {
      "path": "/api/reports/send",
      "schedule": "50 19 * * *"    // 7:50 PM UTC daily
    }
  ]
}
```

When deployed to Vercel:
1. Cron Jobs will automatically call `/api/reports/send` at the specified times
2. The endpoint validates the `X-Cron-Secret` header and sends the report
3. Reports are sent via your connected Gmail account

## Files Created/Modified

### New Files
- **src/lib/reports.ts** — Report generation logic
- **src/app/api/reports/send/route.ts** — API endpoint for sending reports
- **src/components/admin/EmailReportSection.tsx** — UI component for Settings
- **vercel.json** — Cron Job configuration

### Modified Files
- **src/lib/googleApi.ts** — Added `sendGmailHtml()` function for HTML emails
- **src/components/admin/BackupView.tsx** — Integrated EmailReportSection
- **.env** — Added configuration comments

## Local Development / Non-Vercel Deployment

If not using Vercel, you can use `node-cron` or a system cron job:

### Option A: node-cron (Node.js)

```typescript
// src/lib/cron-jobs.ts
import cron from "node-cron";

const REPORT_CRON_SECRET = process.env.REPORT_CRON_SECRET;
const BASE_URL = process.env.BASE_URL || "http://localhost:3000";

// 10:00 AM
cron.schedule("0 10 * * *", async () => {
  await fetch(`${BASE_URL}/api/reports/send`, {
    method: "POST",
    headers: { "X-Cron-Secret": REPORT_CRON_SECRET },
  });
});

// 7:50 PM
cron.schedule("50 19 * * *", async () => {
  await fetch(`${BASE_URL}/api/reports/send`, {
    method: "POST",
    headers: { "X-Cron-Secret": REPORT_CRON_SECRET },
  });
});
```

Then call this initialization in your server startup (e.g., in `src/app/layout.tsx` or a startup script).

### Option B: System Cron (Linux/macOS)

Add to your crontab (`crontab -e`):

```bash
0 10 * * * curl -X POST "http://your-app.com/api/reports/send" -H "X-Cron-Secret: YOUR_SECRET"
50 19 * * * curl -X POST "http://your-app.com/api/reports/send" -H "X-Cron-Secret: YOUR_SECRET"
```

## Architecture

### generateDailyReport()
Fetches metrics from Prisma:
- All tasks (open, completed, overdue, due soon)
- All active users
- Status definitions

### formatReportAsHtml()
Formats metrics as a styled HTML email with:
- Clean table layout
- Color-coded metrics (red for critical, green for good)
- Workload visualization by person

### /api/reports/send (POST)
- Validates `X-Cron-Secret` header
- Calls `generateDailyReport()`
- Formats as HTML
- Sends via Gmail using `sendGmailHtml()`

## Security

- **Secret Key**: The `REPORT_CRON_SECRET` is required in the `X-Cron-Secret` header to prevent unauthorized access
- **No Session Required**: Cron jobs don't have user sessions, so authentication is via the secret header
- **Production**: Use a strong, random secret (generate with `openssl rand -base64 32`)

## Troubleshooting

**Problem**: Email not received
- ✓ Verify `REPORT_EMAIL_RECIPIENT` is set and matches Settings
- ✓ Check Gmail is connected in Settings > Google Connection
- ✓ Test with "Send Test Email" button first
- ✓ Check application logs for errors

**Problem**: "Unauthorized" error when testing
- ✓ Make sure `REPORT_CRON_SECRET` in `.env.local` matches the secret you entered
- ✓ Don't use leading/trailing spaces in the secret

**Problem**: Cron not running on Vercel
- ✓ Ensure `vercel.json` is at the project root
- ✓ Redeploy after updating `vercel.json`
- ✓ Check Vercel dashboard for Cron Job logs

## Testing the Report Format

Visit in development: `/api/reports/send?debug=true` (with valid secret in header) to preview the report format without sending an actual email.

Or modify the endpoint to log the HTML output before sending.
