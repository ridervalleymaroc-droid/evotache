import { getValidAccessToken } from "@/lib/googleAuth";

const GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";
const DRIVE_BASE = "https://www.googleapis.com/drive/v3/files";

async function googleFetch(url: string, init?: RequestInit): Promise<Response> {
  const accessToken = await getValidAccessToken();
  const response = await fetch(url, { ...init, headers: { ...init?.headers, Authorization: `Bearer ${accessToken}` } });
  if (!response.ok) throw new Error(`Google API request failed (${response.status}): ${await response.text()}`);
  return response;
}

function encodeHeaderValue(value: string): string {
  // Plain ASCII values don't need RFC 2047 encoding; anything else (accented names/subjects) does.
  return /^[\x00-\x7F]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value, "utf-8").toString("base64")}?=`;
}

export async function sendGmail(to: string, subject: string, body: string): Promise<{ id: string }> {
  const raw = [`To: ${to}`, `Subject: ${encodeHeaderValue(subject)}`, "MIME-Version: 1.0", "Content-Type: text/plain; charset=UTF-8", "", body].join("\r\n");
  const encoded = Buffer.from(raw, "utf-8").toString("base64url");
  const response = await googleFetch(`${GMAIL_BASE}/messages/send`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ raw: encoded }),
  });
  const data = (await response.json()) as { id: string };
  return { id: data.id };
}

export async function sendGmailHtml(to: string, subject: string, htmlBody: string): Promise<{ id: string }> {
  const raw = [`To: ${to}`, `Subject: ${encodeHeaderValue(subject)}`, "MIME-Version: 1.0", "Content-Type: text/html; charset=UTF-8", "", htmlBody].join("\r\n");
  const encoded = Buffer.from(raw, "utf-8").toString("base64url");
  const response = await googleFetch(`${GMAIL_BASE}/messages/send`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ raw: encoded }),
  });
  const data = (await response.json()) as { id: string };
  return { id: data.id };
}

interface GmailSummary {
  id: string;
  from: string;
  subject: string;
  date: string;
  snippet: string;
}

export async function listRecentGmail(query?: string, maxResults = 10): Promise<GmailSummary[]> {
  const capped = Math.min(Math.max(maxResults, 1), 25);
  const params = new URLSearchParams({ maxResults: String(capped) });
  if (query) params.set("q", query);
  const listResponse = await googleFetch(`${GMAIL_BASE}/messages?${params.toString()}`);
  const list = (await listResponse.json()) as { messages?: { id: string }[] };
  const ids = list.messages ?? [];

  const summaries = await Promise.all(
    ids.map(async ({ id }) => {
      const detailResponse = await googleFetch(`${GMAIL_BASE}/messages/${id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`);
      const detail = (await detailResponse.json()) as { snippet?: string; payload?: { headers?: { name: string; value: string }[] } };
      const headers = detail.payload?.headers ?? [];
      const headerValue = (name: string) => headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";
      return { id, from: headerValue("From"), subject: headerValue("Subject"), date: headerValue("Date"), snippet: detail.snippet ?? "" };
    })
  );
  return summaries;
}

interface DriveFileSummary {
  id: string;
  name: string;
  mimeType: string;
  webViewLink: string | null;
  modifiedTime: string;
}

export async function listDriveFiles(query?: string): Promise<DriveFileSummary[]> {
  const params = new URLSearchParams({ fields: "files(id,name,mimeType,webViewLink,modifiedTime)", pageSize: "25" });
  if (query) params.set("q", `name contains '${query.replace(/'/g, "\\'")}'`);
  const response = await googleFetch(`${DRIVE_BASE}?${params.toString()}`);
  const data = (await response.json()) as { files: DriveFileSummary[] };
  return data.files ?? [];
}

const GOOGLE_DOC_MIME = "application/vnd.google-apps.document";
const GOOGLE_SHEET_MIME = "application/vnd.google-apps.spreadsheet";

export async function readDriveFile(fileId: string): Promise<string> {
  const metaResponse = await googleFetch(`${DRIVE_BASE}/${fileId}?fields=mimeType,name`);
  const meta = (await metaResponse.json()) as { mimeType: string; name: string };

  if (meta.mimeType === GOOGLE_DOC_MIME) {
    const response = await googleFetch(`${DRIVE_BASE}/${fileId}/export?mimeType=text/plain`);
    return response.text();
  }
  if (meta.mimeType === GOOGLE_SHEET_MIME) {
    const response = await googleFetch(`${DRIVE_BASE}/${fileId}/export?mimeType=text/csv`);
    return response.text();
  }
  if (!meta.mimeType.startsWith("text/") && meta.mimeType !== "application/json") {
    throw new Error(`"${meta.name}" is a ${meta.mimeType} file — only Google Docs, Google Sheets, and plain-text files can be read right now.`);
  }
  const response = await googleFetch(`${DRIVE_BASE}/${fileId}?alt=media`);
  return response.text();
}
