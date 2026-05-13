// NODE — Prepare AI Agent Input
// Paste this into the "Prepare-Hub-Request" Code node in n8n.
// Replaces the old version that built the full OpenAI request body.
// The AI Agent node now owns: system prompt, user prompt structure, model, temperature, max_tokens.
//
// Output:  { articleText: string, articleCount: number }
// Usage in AI Agent → Prompt field:  {{ $json.userPrompt }}

// ── CONFIG ────────────────────────────────────────────────────────────────────
const MAX_ARTICLES = 15; // stay within model context window
// ─────────────────────────────────────────────────────────────────────────────

const articles = items.map(item => item.json);
const limited = articles.slice(0, MAX_ARTICLES);

const articleText = limited.map((a, index) => {
  return `Artikel ${index + 1}
Quelle: ${a.source || 'Unbekannt'}
Titel: ${a.title || ''}
Lead: ${a.lead || ''}
Autor: ${a.author || ''}
Inhalt:
${a.body || a.teaser || ''}

---`;
}).join('\n\n');

const userPrompt = `Hier sind ${limited.length} Artikel.

Erstelle:
1. Executive Summary (max. 8 Bulletpoints)
2. Zentrale Themen
3. Gemeinsame Argumentationslinien
4. Unterschiede / Spannungsfelder
5. Übergreifende Trends

Artikel:
${articleText}`;

return [
  {
    json: {
      userPrompt,
      articleText,
      articleCount: limited.length,
    },
  },
];
