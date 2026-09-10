"use client";

import { useEffect, useState } from "react";
import { useToast } from "@/components/ui/Toast";
import { CheckIcon, RefreshIcon, MailIcon } from "@/components/ui/icons";

const inputClass =
  "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:focus:ring-indigo-950";

export interface EmailReportConfig {
  enabled: boolean;
  recipient: string;
  cronSchedules: string[]; // "HH:mm" format
}

export function EmailReportSection() {
  const [config, setConfig] = useState<EmailReportConfig>({
    enabled: false,
    recipient: "",
    cronSchedules: ["10:00", "19:50"],
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [recipient, setRecipient] = useState("");
  const [enabled, setEnabled] = useState(false);
  const toast = useToast();

  useEffect(() => {
    // Load configuration from localStorage or API
    const stored = localStorage.getItem("emailReportConfig");
    if (stored) {
      const parsed = JSON.parse(stored);
      setConfig(parsed);
      setRecipient(parsed.recipient);
      setEnabled(parsed.enabled);
    }
    setLoading(false);
  }, []);

  async function handleSave() {
    if (!enabled && !recipient.trim()) {
      toast.error("Please enter a recipient email or disable the report.");
      return;
    }

    if (enabled && !recipient.trim()) {
      toast.error("Recipient email is required to enable the report.");
      return;
    }

    // Validate email format
    if (enabled && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient.trim())) {
      toast.error("Please enter a valid email address.");
      return;
    }

    setSaving(true);
    try {
      const newConfig: EmailReportConfig = {
        enabled,
        recipient: recipient.trim(),
        cronSchedules: config.cronSchedules,
      };

      // Save to localStorage (in production, could save to a database)
      localStorage.setItem("emailReportConfig", JSON.stringify(newConfig));
      setConfig(newConfig);

      toast.success(
        enabled ? `Report enabled for ${recipient.trim()}.` : "Report disabled."
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save.");
    } finally {
      setSaving(false);
    }
  }

  async function handleTestEmail() {
    if (!recipient.trim()) {
      toast.error("Please enter a recipient email first.");
      return;
    }

    // Validate email format
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient.trim())) {
      toast.error("Please enter a valid email address.");
      return;
    }

    setSaving(true);
    try {
      // Call the report API to send a test email immediately
      const cronSecret = prompt(
        "Enter CRON_SECRET to send a test email:"
      );
      if (!cronSecret) return;

      const response = await fetch("/api/reports/send", {
        method: "POST",
        headers: {
          "X-Cron-Secret": cronSecret,
        },
      });

      const data = await response.json();

      if (!response.ok) {
        const errorMsg = data.error || "Failed to send test email";
        throw new Error(errorMsg);
      }

      toast.success(`Test email sent to ${data.recipient}.`);
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : "Failed to send test email. Check credentials."
      );
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
          Loading...
        </h2>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center gap-2 mb-4">
        <MailIcon className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
        <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
          Daily Report by Email
        </h2>
      </div>

      <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">
        Receive an automated daily report with task metrics at 10:00 AM and 7:50 PM.
        The report includes open tasks, overdue items, due soon, completed today, and workload per person.
      </p>

      <div className="space-y-4">
        {/* Enable/Disable Toggle */}
        <div className="flex items-center gap-3">
          <input
            type="checkbox"
            id="enableReport"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="w-4 h-4 rounded border-slate-300 cursor-pointer"
            disabled={saving}
          />
          <label htmlFor="enableReport" className="text-sm text-slate-700 dark:text-slate-300 cursor-pointer">
            Enable daily reports
          </label>
        </div>

        {/* Recipient Email Input */}
        <div>
          <label htmlFor="recipient" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
            Recipient Email
          </label>
          <input
            id="recipient"
            type="email"
            placeholder="your-email@example.com"
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            className={inputClass}
            disabled={saving}
          />
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            The email address where reports will be sent.
          </p>
        </div>

        {/* Schedule Info */}
        <div className="bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded-lg p-3">
          <p className="text-sm text-blue-900 dark:text-blue-100">
            <strong>Schedule:</strong> {config.cronSchedules.join(" and ")} (UTC/Casablanca timezone)
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-3 pt-2">
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {saving ? (
              <>
                <RefreshIcon className="w-4 h-4 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <CheckIcon className="w-4 h-4" />
                Save
              </>
            )}
          </button>

          <button
            onClick={handleTestEmail}
            disabled={saving || !recipient.trim()}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-slate-200 text-slate-900 dark:bg-slate-700 dark:text-slate-100 text-sm font-medium rounded-lg hover:bg-slate-300 dark:hover:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {saving ? (
              <>
                <RefreshIcon className="w-4 h-4 animate-spin" />
                Sending...
              </>
            ) : (
              <>
                <MailIcon className="w-4 h-4" />
                Send Test Email
              </>
            )}
          </button>
        </div>

        <p className="text-xs text-slate-500 dark:text-slate-400 pt-2">
          💡 Save first, then use "Send Test Email" to verify your email and secret key.
        </p>
      </div>
    </section>
  );
}
