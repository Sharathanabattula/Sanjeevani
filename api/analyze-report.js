// POST /api/analyze-report
// Reads a lab / medical report (image OR PDF) via Google Gemini and returns a
// plain-language interpretation + dietary guidance. The API key stays server-side.
// This is wellness guidance, NOT a medical diagnosis — the prompt enforces that.

export const config = { maxDuration: 60 };

const ANALYZE_PROMPT = `You are a careful, warm clinical lab-report interpreter for an Indian audience. You read a medical/lab report (image or PDF) and explain it in plain, reassuring language a non-medical person understands.

HARD RULES:
- You are NOT a doctor and must NOT diagnose or prescribe. Frame everything as general wellness guidance and always defer serious calls to a physician.
- Only report values you can actually see in the document. Never invent numbers. If a value is unclear, mark its status "unknown".
- Be calm and non-alarming, but honest. If something looks genuinely urgent (e.g. critically abnormal value), set doctor_flag accordingly.

PERSONALIZATION CONTEXT (apply when present):
{PROFILE_CONTEXT}

Extract the test panel, classify each marker against its reference range, and give specific, Indian-friendly dietary guidance tied to the findings (e.g. high LDL → oats, more soluble fibre, less ghee/fried; high fasting glucose → low-GI swaps, smaller rice portions; low haemoglobin → iron + vitamin C pairing, dates, ragi, leafy greens; low vitamin D → sunlight + fortified foods).

Return ONLY valid minified JSON (no markdown, no commentary):
{
  "title": "string (best guess of report type, e.g. 'Lipid Profile', 'Complete Blood Count', 'HbA1c', 'Thyroid Panel', 'Liver Function Test')",
  "report_date": "string (date on the report if visible, else '')",
  "summary": "string (<=240 chars, the overall picture in plain language)",
  "markers": [
    {"name":"string","value":"string","unit":"string","ref_range":"string","status":"low|normal|high|borderline|unknown","meaning":"string (<=120 chars, plain language)"}
  ],
  "concerns": ["string (<=100 chars each, key things to watch)"],
  "foods_to_favor": ["string (specific Indian foods)"],
  "foods_to_limit": ["string"],
  "lifestyle": ["string (non-food tips, <=100 chars)"],
  "doctor_flag": "none|routine|soon|urgent",
  "doctor_note": "string (<=160 chars, what to discuss with a doctor and why)"
}
Limits: markers <=20, concerns <=5, foods_to_favor <=8, foods_to_limit <=8, lifestyle <=5.
If the document is NOT a medical/lab report, return {"error":"not_report"}.`;

function normalize(r) {
  const str = (v, max, d = '') => String(v ?? d).slice(0, max);
  const arr = (v, n, max) => (Array.isArray(v) ? v.slice(0, n).map(x => str(x, max)).filter(Boolean) : []);
  const statuses = ['low', 'normal', 'high', 'borderline', 'unknown'];
  const flags = ['none', 'routine', 'soon', 'urgent'];

  const markers = (Array.isArray(r.markers) ? r.markers.slice(0, 20) : []).map(m => ({
    name: str(m?.name, 60, 'Marker'),
    value: str(m?.value, 30, ''),
    unit: str(m?.unit, 20, ''),
    ref_range: str(m?.ref_range, 40, ''),
    status: statuses.includes(m?.status) ? m.status : 'unknown',
    meaning: str(m?.meaning, 140, ''),
  })).filter(m => m.name && m.name !== 'Marker');

  return {
    title: str(r.title, 80, 'Lab report'),
    report_date: str(r.report_date, 40, ''),
    summary: str(r.summary, 280, ''),
    markers,
    concerns: arr(r.concerns, 5, 120),
    foods_to_favor: arr(r.foods_to_favor, 8, 60),
    foods_to_limit: arr(r.foods_to_limit, 8, 60),
    lifestyle: arr(r.lifestyle, 5, 120),
    doctor_flag: flags.includes(r.doctor_flag) ? r.doctor_flag : 'routine',
    doctor_note: str(r.doctor_note, 200, ''),
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'server_misconfigured', detail: 'GEMINI_API_KEY not set' });
  const model = process.env.GEMINI_MODEL || 'gemini-flash-latest';

  const { file_base64, mime_type, profile } = req.body || {};
  if (!file_base64 || typeof file_base64 !== 'string') {
    return res.status(400).json({ error: 'file_base64_required' });
  }

  // Build personalization block from the (client-validated) profile
  const PROFILE_CONTEXT = (() => {
    if (!profile || typeof profile !== 'object') return 'No user profile shared — give general guidance.';
    const num = (v) => (v != null && isFinite(Number(v)) ? Number(v) : null);
    const parts = [];
    const age = num(profile.age); if (age) parts.push(`Age ${age}`);
    if (typeof profile.gender === 'string') parts.push(String(profile.gender).slice(0, 20));
    const h = num(profile.height_cm), w = num(profile.weight_kg);
    if (h && w && h > 0) { const m = h / 100; parts.push(`BMI ${Math.round((w / (m * m)) * 10) / 10}`); }
    const conds = Array.isArray(profile.conditions) ? profile.conditions.slice(0, 6).map(String) : [];
    if (conds.length) parts.push(`Known conditions: ${conds.join(', ').slice(0, 160)}`);
    const veg = profile.is_vegetarian === true ? 'vegetarian' : profile.is_vegetarian === false ? 'non-vegetarian' : null;
    if (veg) parts.push(`Diet: ${veg}`);
    return parts.length
      ? `The user: ${parts.join(' · ')}. Tailor food guidance to this (e.g. vegetarian iron sources if low haemoglobin).`
      : 'No user profile shared — give general guidance.';
  })();

  const finalPrompt = ANALYZE_PROMPT.replace('{PROFILE_CONTEXT}', PROFILE_CONTEXT);
  const b64 = file_base64.includes(',') ? file_base64.split(',')[1] : file_base64;
  const mime = (mime_type || 'image/jpeg').toLowerCase();

  // Size cap (~14 MB base64 ≈ 10 MB binary)
  if (b64.length > 14_000_000) return res.status(413).json({ error: 'file_too_large' });

  // ---- Provider: Gemini (reads images AND PDFs) ----
  async function callGemini() {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const body = {
      contents: [{ parts: [{ text: finalPrompt }, { inline_data: { mime_type: mime, data: b64 } }] }],
      generationConfig: { temperature: 0.2, responseMimeType: 'application/json', maxOutputTokens: 4096, thinkingConfig: { thinkingBudget: 0 } },
    };
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok) { const t = await r.text().catch(() => ''); throw new Error(`gemini_http_${r.status}: ${t.slice(0, 200)}`); }
    const json = await r.json();
    const text = json?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    return JSON.parse(text);
  }

  // ---- Provider: Groq / Llama 4 Scout (images only — cannot read PDFs) ----
  async function callGroq() {
    const groqKey = process.env.GROQ_API_KEY;
    if (!groqKey) return null;
    if (!mime.startsWith('image/')) return null;
    const groqModel = process.env.GROQ_MODEL || 'meta-llama/llama-4-scout-17b-16e-instruct';
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${groqKey}` },
      body: JSON.stringify({
        model: groqModel, temperature: 0.2, max_tokens: 4096, response_format: { type: 'json_object' },
        messages: [{ role: 'user', content: [{ type: 'text', text: finalPrompt }, { type: 'image_url', image_url: { url: `data:${mime};base64,${b64}` } }] }],
      }),
    });
    if (!r.ok) { const t = await r.text().catch(() => ''); throw new Error(`groq_http_${r.status}: ${t.slice(0, 200)}`); }
    const json = await r.json();
    const text = json?.choices?.[0]?.message?.content || '';
    return JSON.parse(text);
  }

  // Groq-first for images (free); Gemini handles PDFs + acts as fallback.
  let parsed = null, lastErr = null;
  try { parsed = await callGroq(); } catch (e) { lastErr = e; }
  if (!parsed) { try { parsed = await callGemini(); } catch (e) { lastErr = e; } }
  if (!parsed) {
    return res.status(502).json({ error: 'gemini_error', detail: String((lastErr && lastErr.message) || 'no_response').slice(0, 300) });
  }
  if (parsed.error === 'not_report') return res.status(422).json({ error: 'not_report' });
  return res.status(200).json(normalize(parsed));
}
