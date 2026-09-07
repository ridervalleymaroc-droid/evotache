import { NextRequest, NextResponse } from "next/server";
import { getOpenAIKey } from "@/lib/apiKeyStore";

const OPENAI_MODEL = "gpt-4o-mini";

function generateSystemPrompt(moduleLabel: string): string {
  return `You are a project management assistant. Given a user's description of work to be done, break it down into a list of concrete, actionable ${moduleLabel}.
Return ONLY a JSON object of the shape: { "tasks": [ { "title": string, "description": string, "priority": "urgent" | "high" | "normal" | "low", "dueInDays": number | null } ] }.
- "title" is short and action-oriented (max ~80 characters).
- "description" adds 1-2 sentences of useful detail, or an empty string if nothing to add.
- "priority" reflects urgency; default to "normal" if unclear.
- "dueInDays" is a rough number of days from today this ${moduleLabel.replace(/s$/, "")} should be done by, or null if there is no clear deadline.
Return between 1 and 12 ${moduleLabel}. Do not include any text other than the JSON object.`;
}

function analyzeSystemPrompt(moduleLabel: string): string {
  return `You are a project management analyst. You are given a JSON snapshot of a team's current ${moduleLabel} (counts by status, priority, overdue items, workload, and completion rate).
Return ONLY a JSON object of the shape: { "analysis": string }.
- "analysis" is plain text (you may use short paragraphs and lines starting with "-" for bullet points), under 220 words.
- Call out risks first (overdue or unassigned work, workload imbalances), then give 2-4 concrete, actionable recommendations.
- If the user asks a specific question, answer it directly using only the data provided; if the data can't answer it, say so.
Do not include any text other than the JSON object.`;
}

interface RawSuggestedTask {
  title?: unknown;
  description?: unknown;
  priority?: unknown;
  dueInDays?: unknown;
}

export async function POST(request: NextRequest) {
  try {
    const apiKey = await getOpenAIKey();
    if (!apiKey) {
      return NextResponse.json(
        { error: "No OpenAI API key configured. Add one in Admin → Integrations, or set OPENAI_API_KEY on the server." },
        { status: 501 }
      );
    }

    const body = await request.json().catch(() => null);
    const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
    const mode = body?.mode === "analyze" ? "analyze" : "generate";
    const taskModule = body?.module === "dispute" ? "dispute" : "task";
    const moduleLabel = taskModule === "dispute" ? "disputes" : "tasks";

    if (mode === "generate" && !prompt) {
      return NextResponse.json({ error: "Missing prompt." }, { status: 400 });
    }

    const userContent =
      mode === "analyze"
        ? `Data snapshot:\n${JSON.stringify(body?.context ?? {})}\n\n${prompt ? `Question: ${prompt}` : "Give a general analysis of this data."}`
        : prompt;

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        response_format: { type: "json_object" },
        temperature: mode === "analyze" ? 0.3 : 0.4,
        messages: [
          { role: "system", content: mode === "analyze" ? analyzeSystemPrompt(moduleLabel) : generateSystemPrompt(moduleLabel) },
          { role: "user", content: userContent },
        ],
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      return NextResponse.json({ error: `OpenAI request failed (${response.status}): ${errorBody.slice(0, 300)}` }, { status: 502 });
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== "string") {
      return NextResponse.json({ error: "Unexpected response from OpenAI." }, { status: 502 });
    }

    let parsed: { tasks?: RawSuggestedTask[]; analysis?: unknown };
    try {
      parsed = JSON.parse(content);
    } catch {
      return NextResponse.json({ error: "Could not parse the assistant's response." }, { status: 502 });
    }

    if (mode === "analyze") {
      const analysis = typeof parsed.analysis === "string" ? parsed.analysis : "";
      return NextResponse.json({ analysis });
    }

    const tasks = Array.isArray(parsed.tasks)
      ? parsed.tasks
          .filter((t): t is RawSuggestedTask & { title: string } => typeof t?.title === "string" && t.title.trim().length > 0)
          .map((t) => ({
            title: t.title.trim(),
            description: typeof t.description === "string" ? t.description : "",
            priority: typeof t.priority === "string" ? t.priority : "normal",
            dueInDays: typeof t.dueInDays === "number" ? t.dueInDays : null,
          }))
      : [];

    return NextResponse.json({ tasks });
  } catch {
    return NextResponse.json({ error: "Unexpected server error." }, { status: 500 });
  }
}

