// POST /api/gemini-vision
// Proxies the food-scanner image to Google Gemini Vision so the API key
// never reaches the browser. Returns the same JSON shape the client
// already expects { name, calories_kcal, carbs_g, ... }.

export const config = { maxDuration: 30 };

const ANALYZE_PROMPT = `You are a nutrition analyst with deep knowledge of Indian cuisine.
Analyze the food in this image. Identify the dish (favor specific Indian names if applicable), estimate calories and macronutrients for ONE typical serving, and give one short, practical health suggestion.

Return ONLY valid minified JSON matching this schema (no markdown fences, no commentary):
{
  "name": "string (e.g. 'Veg Thali', 'Masala Dosa', 'Mixed Berry Bowl')",
  "calories_kcal": number,
  "carbs_g": number,
  "fiber_g": number,
  "protein_g": number,
  "fats_g": number,
  "saturated_fats_g": number,
  "verdict": "Healthy" | "Moderate" | "Indulgent",
  "suggestion": "one short sentence, <= 25 words"
}
If the image is not food, return {"error": "not_food"}.`;

function normalizeMeal(m) {
  const num = (v, d = 0) => (typeof v === 'number' && isFinite(v) ? Math.round(v) : d);
  const verdict = ['Healthy', 'Moderate', 'Indulgent'].includes(m.verdict) ? m.verdict : 'Moderate';
  return {
    name: String(m.name || 'Meal').slice(0, 60),
    calories_kcal: num(m.calories_kcal),
    carbs_g: num(m.carbs_g),
    fiber_g: num(m.fiber_g),
    protein_g: num(m.protein_g),
    fats_g: num(m.fats_g),
    saturated_fats_g: num(m.saturated_fats_g),
    verdict,
    suggestion: String(m.suggestion || 'Stay mindful of portions.').slice(0, 200),
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'server_misconfigured', detail: 'GEMINI_API_KEY not set' });
  }
  const model = process.env.GEMINI_MODEL || 'gemini-flash-latest';

  const { image_base64, mime_type } = req.body || {};
  if (!image_base64 || typeof image_base64 !== 'string') {
    return res.status(400).json({ error: 'image_base64_required' });
  }
  // Strip data URL prefix if present
  const b64 = image_base64.includes(',') ? image_base64.split(',')[1] : image_base64;
  const mime = (mime_type || 'image/jpeg').toLowerCase();

  // Soft size cap (~7 MB base64 ≈ 5 MB binary)
  if (b64.length > 7_500_000) {
    return res.status(413).json({ error: 'image_too_large' });
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const body = {
    contents: [{
      parts: [
        { text: ANALYZE_PROMPT },
        { inline_data: { mime_type: mime, data: b64 } },
      ],
    }],
    generationConfig: {
      temperature: 0.3,
      responseMimeType: 'application/json',
      maxOutputTokens: 1024,
      thinkingConfig: { thinkingBudget: 0 },
    },
  };

  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      const errText = await r.text().catch(() => '');
      return res.status(502).json({ error: 'gemini_error', status: r.status, detail: errText.slice(0, 300) });
    }
    const json = await r.json();
    const text = json?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    let parsed;
    try { parsed = JSON.parse(text); }
    catch { return res.status(502).json({ error: 'bad_model_response', detail: text.slice(0, 200) }); }

    if (parsed.error === 'not_food') {
      return res.status(422).json({ error: 'not_food' });
    }
    return res.status(200).json(normalizeMeal(parsed));
  } catch (err) {
    return res.status(500).json({ error: 'proxy_failure', detail: String(err.message || err) });
  }
}
