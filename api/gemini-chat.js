// POST /api/gemini-chat
// Streams a chat response to the browser as Server-Sent Events in Gemini's
// shape ({candidates:[{content:{parts:[{text}]}}]}), which the client parses.
// Groq (free, Llama) is tried first; Gemini is the fallback. Keys stay server-side.
// Browser sends { messages: [{role, text}], systemInstruction: string }.

export const config = { runtime: 'edge' };

const json = (obj, status) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
const sse = (stream) => new Response(stream, {
  status: 200,
  headers: {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  },
});

// Stream Groq's OpenAI-style SSE and re-emit it in Gemini's SSE shape.
async function groqStream(groqKey, messages, sys) {
  const model = process.env.GROQ_TEXT_MODEL || 'llama-3.3-70b-versatile';
  const gm = [];
  if (sys) gm.push({ role: 'system', content: sys });
  for (const m of messages.slice(-24)) {
    gm.push({ role: m.role === 'user' ? 'user' : 'assistant', content: String(m.text || '').slice(0, 4000) });
  }
  const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${groqKey}` },
    body: JSON.stringify({ model, temperature: 0.7, max_tokens: 1024, stream: true, messages: gm }),
  });
  if (!r.ok || !r.body) throw new Error('groq_http_' + r.status);

  const dec = new TextDecoder();
  const enc = new TextEncoder();
  let buf = '';
  const transform = new TransformStream({
    transform(chunk, controller) {
      buf += dec.decode(chunk, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop(); // keep the trailing partial line
      for (let line of lines) {
        line = line.trim();
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (!data || data === '[DONE]') continue;
        try {
          const j = JSON.parse(data);
          const piece = j?.choices?.[0]?.delta?.content;
          if (piece) {
            const out = { candidates: [{ content: { parts: [{ text: piece }] } }] };
            controller.enqueue(enc.encode(`data: ${JSON.stringify(out)}\n\n`));
          }
        } catch (_) { /* ignore keep-alive / non-JSON lines */ }
      }
    },
  });
  return r.body.pipeThrough(transform);
}

export default async function handler(req) {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  let body;
  try { body = await req.json(); }
  catch { return json({ error: 'invalid_body' }, 400); }

  const { messages = [], systemInstruction = '' } = body;
  if (!Array.isArray(messages) || messages.length === 0) return json({ error: 'messages_required' }, 400);

  const geminiKey = process.env.GEMINI_API_KEY;
  const groqKey = process.env.GROQ_API_KEY;
  const sys = systemInstruction ? String(systemInstruction).slice(0, 8000) : '';

  // 1) Groq first (free, higher limits) — only if its stream actually starts.
  if (groqKey) {
    try {
      const stream = await groqStream(groqKey, messages, sys);
      if (stream) return sse(stream);
    } catch (_) { /* fall through to Gemini */ }
  }

  // 2) Gemini fallback (also the default when GROQ_API_KEY is unset).
  if (!geminiKey) return json({ error: 'server_misconfigured' }, 500);
  const model = process.env.GEMINI_MODEL || 'gemini-flash-latest';
  const trimmed = messages.slice(-24).map(m => ({
    role: m.role === 'user' ? 'user' : 'model',
    parts: [{ text: String(m.text || '').slice(0, 4000) }],
  }));
  const upstreamBody = {
    systemInstruction: sys ? { parts: [{ text: sys }] } : undefined,
    contents: trimmed,
    generationConfig: { temperature: 0.7, maxOutputTokens: 1024, thinkingConfig: { thinkingBudget: 0 } },
  };
  const upstreamUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${encodeURIComponent(geminiKey)}`;
  const upstream = await fetch(upstreamUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(upstreamBody),
  });
  if (!upstream.ok || !upstream.body) {
    const errText = await upstream.text().catch(() => '');
    return json({ error: 'gemini_error', status: upstream.status, detail: errText.slice(0, 300) }, 502);
  }
  return sse(upstream.body);
}
