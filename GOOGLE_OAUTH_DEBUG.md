# Google OAuth Configuration — Debug Guide

## 🔴 Problem You're Experiencing

Error: **"Google OAuth isn't configured."** when testing "Send Test Email"

### Why This Happens

1. **Google Sheets seems to work** because the access token hasn't expired yet
2. **Email test fails immediately** because it tries to refresh the token (if expiring soon)
3. **Refresh fails** because `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are missing from `.env.local`

Both use the same function `getValidAccessToken()` → `refreshAccessToken()`, which requires the OAuth credentials to refresh.

---

## ✅ Solution: Add Missing Environment Variables

You need to add these two variables to `.env.local`:

```bash
GOOGLE_CLIENT_ID="YOUR_VALUE_HERE"
GOOGLE_CLIENT_SECRET="YOUR_VALUE_HERE"
```

### Step-by-Step: How to Get These Credentials

#### 1. Go to Google Cloud Console
- Visit: https://console.cloud.google.com/
- Sign in with the same Google account used for Gmail/Drive/Sheets

#### 2. Create or Select Your Project
- If you don't have a project yet:
  - Click "Select a Project" → "New Project"
  - Name it "EvoTasks" (or similar)
  - Click "Create"

#### 3. Enable Required APIs
Go to "APIs & Services" → "Library", then enable:
- ✅ **Gmail API**
- ✅ **Google Drive API**
- ✅ **Google Sheets API**

(Search for each by name and click "Enable")

#### 4. Create OAuth 2.0 Credentials
- Go to "APIs & Services" → "Credentials"
- Click "Create Credentials" → "OAuth 2.0 Client ID"
- Choose application type: **Web Application**
- Name: "EvoTasks" (or similar)

#### 5. Configure Authorized Redirect URI
In the "Authorized redirect URIs" section, add:
```
https://evotasks.app/api/integrations/google/callback
```

(If testing locally on `http://localhost:3000`, add that too:)
```
http://localhost:3000/api/integrations/google/callback
```

Click "Create"

#### 6. Copy Your Credentials
After clicking "Create", you'll see a popup with:
- **Client ID** (long string ending in `.apps.googleusercontent.com`)
- **Client Secret** (long alphanumeric string)

Copy both values.

#### 7. Update `.env.local`
Edit `.env.local` and replace:
```bash
GOOGLE_CLIENT_ID="YOUR_GOOGLE_CLIENT_ID_HERE"
GOOGLE_CLIENT_SECRET="YOUR_GOOGLE_CLIENT_SECRET_HERE"
```

With your actual values:
```bash
GOOGLE_CLIENT_ID="123456789012-abcdefghijklmnopqrstuvwxyz123456.apps.googleusercontent.com"
GOOGLE_CLIENT_SECRET="GOCSPX-1234567890abcdefghijklmnop"
```

#### 8. Restart the Dev Server
Close the terminal running `npm run dev` (Ctrl+C), then:
```bash
npm run dev
```

Next.js won't reload `.env.local` changes automatically.

---

## 🔄 If You Already Have Google Connected

If you already have Gmail/Sheets connected to the app:

1. These credentials were used during the initial OAuth flow
2. They're needed again to **refresh** the access token
3. If you lost them, you need to get them from Google Cloud Console (follow steps above)

---

## 🧪 Testing After Configuration

1. Go to **Settings > Backup**
2. Click **"Send Test Email"**
3. When prompted, enter: `EvoTasksSecret2026`
4. You should now get:
   - ✅ **Success**: "Test email sent to..."
   - ❌ Or a **specific error** (e.g., Gmail API error, token expired, etc.)

If you still see "Google OAuth isn't configured", check:
- Restart dev server? (make sure you ran `npm run dev` after editing `.env.local`)
- Variables spelled exactly right? (no extra spaces)
- Quotes correct? (should be: `GOOGLE_CLIENT_ID="value"`)

---

## 📋 What Files Use These Credentials

- `src/lib/googleAuth.ts` → `refreshAccessToken()` needs them
- `src/lib/googleSheets.ts` → uses `getValidAccessToken()` which calls refresh
- `src/lib/googleApi.ts` → `sendGmailHtml()` calls same auth flow
- `src/app/api/reports/send/route.ts` → calls `sendGmailHtml()`

All paths ultimately need `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` for token refresh.

---

## 🔐 Security Notes

- ✅ These credentials are **server-only** (never sent to browser)
- ✅ Store them securely in `.env.local` (which is `.gitignore`d)
- ✅ On production (Vercel), add them via "Environment Variables" in project settings
- ⚠️ Never commit `.env.local` to git

---

## 📞 Still Having Issues?

Check the terminal logs when you test (look for `[Daily Report]` messages):
```
[Daily Report] ERROR: REPORT_CRON_SECRET not configured in environment
[Daily Report] ERROR: Invalid secret
[Daily Report] ERROR: Google API request failed (401)
```

These specific logs will tell you exactly what's wrong.
