// POST /api/gemini-chat
// Streams a Gemini chat response to the browser as Server-Sent Events.
// Browser sends { messages: [{role, text}], systemInstruction: string }.
// Server keeps the API key secret and proxies through Gemini's streaming endpoint.

export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method_not_allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'server_misconfigured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const model = process.env.GEMINI_MODEL || 'gemini-flash-latest';

  let body;
  try { body = await req.json(); }
  catch { return new Response(JSON.stringify({ error: 'invalid_body' }), { status: 400 }); }

  const { messages = [], systemInstruction = '' } = body;
  if (!Array.isArray(messages) || messages.length === 0) {
    return new Response(JSON.stringify({ error: 'messages_required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Cap context to last 24 turns to keep latency + cost down
  const trimmed = messages.slice(-24).map(m => ({
    role: m.role === 'user' ? 'user' : 'model',
    parts: [{ text: String(m.text || '').slice(0, 4000) }],
  }));

  const upstreamBody = {
    systemInstruction: systemInstruction ? { parts: [{ text: String(systemInstruction).slice(0, 8000) }] } : undefined,
    contents: trimmed,
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 1024,
      thinkingConfig: { thinkingBudget: 0 },
    },
  };

  const upstreamUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey)}`;

  const upstream = await fetch(upstreamUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(upstreamBody),
  });

  if (!upstream.ok || !upstream.body) {
    const errText = await upstream.text().catch(() => '');
    return new Response(JSON.stringify({ error: 'gemini_error', status: upstream.status, detail: errText.slice(0, 300) }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Pass the SSE stream straight back to the browser.
  return new Response(upstream.body, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
