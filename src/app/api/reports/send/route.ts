import { NextRequest, NextResponse } from "next/server";
import { generateDailyReport, formatReportAsHtml } from "@/lib/reports";
import { sendGmailHtml } from "@/lib/googleApi";

export const maxDuration = 60; // Allow up to 60 seconds for this endpoint

/**
 * POST /api/reports/send
 *
 * Generates the daily report and sends it via Gmail.
 * Requires CRON_SECRET header for authentication (called from Vercel Cron without session).
 *
 * Environment variables required:
 * - CRON_SECRET: Secret key for authenticating cron requests
 * - REPORT_EMAIL_RECIPIENT: Email address to send the report to
 */
export async function POST(request: NextRequest) {
  try {
    // Verify the cron secret
    const secret = request.headers.get("X-Cron-Secret");
    const expectedSecret = process.env.CRON_SECRET;

    console.log("[Daily Report] POST /api/reports/send");
    console.log("[Daily Report] Secret from header:", secret ? `***${secret.slice(-4)}` : "MISSING");
    console.log("[Daily Report] Expected secret:", expectedSecret ? `***${expectedSecret.slice(-4)}` : "MISSING");

    if (!expectedSecret) {
      console.error("[Daily Report] ERROR: CRON_SECRET not configured in environment");
      return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
    }

    if (!secret) {
      console.error("[Daily Report] ERROR: X-Cron-Secret header missing");
      return NextResponse.json({ error: "X-Cron-Secret header missing" }, { status: 401 });
    }

    if (secret !== expectedSecret) {
      console.error("[Daily Report] ERROR: Secret mismatch");
      console.error("[Daily Report] Received:", secret);
      console.error("[Daily Report] Expected:", expectedSecret);
      return NextResponse.json({ error: "Invalid secret" }, { status: 401 });
    }

    // Get the recipient email
    const recipientEmail = process.env.REPORT_EMAIL_RECIPIENT;
    if (!recipientEmail) {
      return NextResponse.json(
        { error: "REPORT_EMAIL_RECIPIENT not configured" },
        { status: 500 }
      );
    }

    console.log("[Daily Report] Generating report for:", recipientEmail.substring(0, 5) + "***");

    // Generate the report metrics
    const metrics = await generateDailyReport();

    // Format as HTML
    const htmlBody = formatReportAsHtml(metrics);

    // Send via Gmail
    const now = new Date();
    const subject = `Daily Report — ${now.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    })}`;

    console.log("[Daily Report] Sending email via Gmail...");
    const result = await sendGmailHtml(recipientEmail, subject, htmlBody);

    console.log("[Daily Report] Email sent successfully, messageId:", result.id);

    return NextResponse.json(
      {
        success: true,
        messageId: result.id,
        metrics,
        recipient: recipientEmail,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("[Daily Report] Error sending report:", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to send report",
      },
      { status: 500 }
    );
  }
}

/**
 * GET /api/reports/send
 *
 * Health check endpoint to verify the report sending is working.
 */
export async function GET(request: NextRequest) {
  try {
    // Verify the cron secret
    const secret = request.headers.get("X-Cron-Secret");
    const expectedSecret = process.env.CRON_SECRET;

    if (!expectedSecret || !secret || secret !== expectedSecret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const recipientEmail = process.env.REPORT_EMAIL_RECIPIENT;
    return NextResponse.json({
      configured: !!recipientEmail,
      recipient: recipientEmail ? `${recipientEmail.charAt(0)}***${recipientEmail.slice(-10)}` : null,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Error checking status" },
      { status: 500 }
    );
  }
}
