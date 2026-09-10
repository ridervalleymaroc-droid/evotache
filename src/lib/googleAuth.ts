import { db } from "@/lib/db";
import { SHEETS_SCOPE } from "@/config/googleScopes";

const REDIRECT_URI = "https://evotasks.app/api/integrations/google/callback";
// The Sheets scope was added after some connections already existed —
// anyone connected before that needs to reconnect once (the "Connect" link
// uses prompt=consent, so clicking it again just adds the scope).
const SCOPES = [
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/drive.readonly",
  SHEETS_SCOPE,
  "https://www.googleapis.com/auth/userinfo.email",
];

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope: string;
}

export function getGoogleAuthUrl(): string {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) throw new Error("GOOGLE_CLIENT_ID is not configured.");
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    access_type: "offline",
    prompt: "consent",
    scope: SCOPES.join(" "),
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

/** Exchanges an OAuth code for tokens, resolves the connected account's
 * email, and upserts the single GoogleConnection row (this app only ever
 * has one shared Google connection, used by every agent with the
 * gmail/drive tool enabled). */
export async function exchangeCodeForTokens(code: string): Promise<void> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      "Google OAuth credentials not configured. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to .env.local. " +
      "See GOOGLE_OAUTH_DEBUG.md for setup instructions."
    );
  }

  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: REDIRECT_URI,
      grant_type: "authorization_code",
    }),
  });
  if (!tokenResponse.ok) throw new Error(`Google token exchange failed: ${await tokenResponse.text()}`);
  const tokens = (await tokenResponse.json()) as TokenResponse;
  if (!tokens.refresh_token) {
    throw new Error("Google didn't return a refresh token — try disconnecting any prior access at myaccount.google.com/permissions and connecting again.");
  }

  const userInfoResponse = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  if (!userInfoResponse.ok) throw new Error("Failed to resolve the connected Google account's email.");
  const userInfo = (await userInfoResponse.json()) as { email: string };

  const existing = await db.googleConnection.findFirst();
  const data = {
    email: userInfo.email,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
    scopes: tokens.scope.split(" "),
  };
  if (existing) {
    await db.googleConnection.update({ where: { id: existing.id }, data });
  } else {
    await db.googleConnection.create({ data: { ...data, connectedBy: userInfo.email } });
  }
}

async function refreshAccessToken(connection: { id: string; refreshToken: string }): Promise<string> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      "Google OAuth credentials not configured. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to .env.local. " +
      "See GOOGLE_OAUTH_DEBUG.md for setup instructions."
    );
  }

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: connection.refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
    }),
  });
  if (!response.ok) throw new Error(`Failed to refresh the Google access token: ${await response.text()}`);
  const tokens = (await response.json()) as TokenResponse;
  await db.googleConnection.update({
    where: { id: connection.id },
    data: { accessToken: tokens.access_token, expiresAt: new Date(Date.now() + tokens.expires_in * 1000) },
  });
  return tokens.access_token;
}

/** Every Gmail/Drive call goes through this — returns a guaranteed-valid access token, refreshing first if it's expired or about to be. */
export async function getValidAccessToken(): Promise<string> {
  const connection = await db.googleConnection.findFirst();
  if (!connection) throw new Error("Google isn't connected — ask an admin to connect it in Assistant IA settings.");
  const expiresSoon = connection.expiresAt.getTime() - Date.now() < 60_000;
  if (expiresSoon) return refreshAccessToken(connection);
  return connection.accessToken;
}

export interface GoogleConnectionStatus {
  connected: boolean;
  email: string | null;
  scopes: string[];
  connectedAt: string | null;
}

export async function getGoogleConnectionStatus(): Promise<GoogleConnectionStatus> {
  const connection = await db.googleConnection.findFirst();
  if (!connection) return { connected: false, email: null, scopes: [], connectedAt: null };
  return { connected: true, email: connection.email, scopes: connection.scopes, connectedAt: connection.connectedAt.toISOString() };
}

export async function disconnectGoogle(): Promise<void> {
  await db.googleConnection.deleteMany();
}
