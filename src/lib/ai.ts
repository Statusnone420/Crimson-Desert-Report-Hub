import "server-only";

type Attempt = { name: string; url: string; key: string; model: string };

function attempts(): Attempt[] {
  const list: Attempt[] = [];
  if (process.env.GROQ_API_KEY) {
    list.push({
      name: "groq",
      url: "https://api.groq.com/openai/v1/chat/completions",
      key: process.env.GROQ_API_KEY,
      model: "llama-3.3-70b-versatile",
    });
  }
  if (process.env.OPENROUTER_API_KEY) {
    list.push({
      name: "openrouter",
      url: "https://openrouter.ai/api/v1/chat/completions",
      key: process.env.OPENROUTER_API_KEY,
      model: "meta-llama/llama-3.3-70b-instruct:free",
    });
  }
  return list;
}

const SYSTEM_PROMPT = `You are drafting a community bug-report dossier for the game studio Pearl Abyss.
You will receive a deterministic Markdown dossier built from database aggregates.
Rewrite it into clearer, more professional prose while obeying these hard rules:
- Never invent numbers, issues, platforms, or evidence not present in the input.
- Keep every section heading exactly as-is.
- Keep the Markdown table in "Top issues" with identical data.
- Keep all confidence caveats; do not upgrade unverified claims.
- Neutral, respectful, engineering-report tone. No hype, no blame.`;

export async function draftDossierWithAi(
  deterministicMarkdown: string,
): Promise<{ markdown: string; provider: string } | null> {
  for (const attempt of attempts()) {
    try {
      const res = await fetch(attempt.url, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${attempt.key}` },
        body: JSON.stringify({
          model: attempt.model,
          temperature: 0.2,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: deterministicMarkdown },
          ],
        }),
      });
      if (!res.ok) continue;
      const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      const content = data.choices?.[0]?.message?.content?.trim();
      if (content && content.length > 200) return { markdown: content, provider: attempt.name };
    } catch {
      continue;
    }
  }
  return null;
}
