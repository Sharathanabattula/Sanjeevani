// POST /api/gemini-vision
// Proxies the food-scanner image to Google Gemini Vision so the API key
// never reaches the browser. Returns the same JSON shape the client
// already expects { name, calories_kcal, carbs_g, ... }.

export const config = { maxDuration: 30 };

const ANALYZE_PROMPT = `You are an Indian-cuisine nutrition analyst. You have spent years in Indian home kitchens, dhabas, and restaurants and you can SEE the hidden cooking fats other tools miss.

ANALYZE THE IMAGE IN THREE PASSES (think this through silently, then return JSON):

Pass 1 — DECONSTRUCT
Break the meal down into its visible components. A thali is NOT one item — it is rice + dal + 1-2 sabzis + roti/chapati + raita + pickle + maybe a sweet. Chole bhature is bhature + chole curry + onion + pickle. Estimate the portion of each visible item by area on the plate.

Pass 2 — INFER HIDDEN FATS
For each component, estimate the cooking-oil/ghee/butter that ISN'T visible but is realistic for that dish:
- Deep-fried items (bhature, samosa, pakora, vada, puri, jalebi): ~1.5-3 tsp absorbed oil per piece
- Tempered/tadka curries (dal, chole, sabzi): ~1-2 tsp ghee/oil in the tadka per serving
- Restaurant-style gravies (paneer butter masala, butter chicken, dal makhani): ~2-4 tsp butter/cream/ghee per serving
- Roti/chapati: usually 0; paratha/naan: ~1-2 tsp ghee/butter
- South Indian tempering (sambar, rasam, poriyal): ~0.5-1 tsp oil
Sum these into a TOTAL hidden_oil_tsp number (1 tsp ≈ 4-5g fat ≈ 40 kcal).

Pass 3 — COMPUTE & SUGGEST
Sum component calories and macros INCLUDING the hidden fats. Then craft a Smart Swap: a SPECIFIC substitution that an Indian household can actually make, with a quantified benefit (e.g., "~18% lower blood sugar spike", "~3 tsp less oil", "double the protein"). The swap must change the WORST component first, not rewrite the whole meal.

PERSONALIZATION CONTEXT (apply when present):
{PROFILE_CONTEXT}

Examples of good Smart Swaps:
- For Chole Bhature: instead of 2 bhature, try 2 whole-wheat rotis with the same chole + a bowl of cucumber raita — cuts ~3 tsp deep-fry oil and adds 8g protein from yogurt.
- For Paneer Butter Masala + Naan: ask for "less butter, less cream"; swap naan for tandoori roti — saves ~150 kcal and 4g saturated fat per serving.
- For Masala Dosa: pair with sambar instead of coconut chutney — saves ~80 kcal and 6g saturated fat.
- For a thali heavy on rice: replace half the rice with extra dal + a salad portion — same calories, 6g more protein, lower GI.

Return ONLY valid minified JSON matching this schema (no markdown fences, no commentary). Numbers are integers. Component count: 2-6.
{
  "name": "string (most specific Indian name, e.g. 'Chole Bhature', 'Pesarattu', 'Hyderabadi Mutton Biryani')",
  "description": "string (<=80 chars, e.g. '1 plate · 2 bhature, chole, onion + pickle, restaurant-style')",
  "cooking_method": "string (one of: 'deep-fried', 'shallow-fried', 'tempered', 'tandoor', 'steamed', 'boiled', 'raw', 'restaurant-style', 'home-style', 'street-food', 'mixed')",
  "hidden_oil_tsp": number,
  "components": [
    {"name": "string", "portion": "string (e.g. '2 pieces', '1 cup', 'small bowl')", "calories_kcal": number, "fats_g": number, "notes": "string (<=60 chars, e.g. 'maida, deep-fried' or '1 tbsp ghee tadka')"}
  ],
  "calories_kcal": number,
  "carbs_g": number,
  "fiber_g": number,
  "protein_g": number,
  "fats_g": number,
  "saturated_fats_g": number,
  "verdict": "Healthy" | "Moderate" | "Indulgent",
  "verdict_reason": "string (<=70 chars, explain WHY this verdict, naming the main driver)",
  "suggestion": "string (one short generic line, <=25 words — fallback advice)",
  "smart_swap": {
    "instead_of": "string (the specific component or amount being replaced, e.g. '2 deep-fried bhature')",
    "swap_to": "string (the specific replacement, e.g. '2 whole-wheat rotis + cucumber raita')",
    "why": "string (<=90 chars, quantified benefit, e.g. 'cuts ~3 tsp cooking oil, adds 8g yogurt protein, ~18% lower sugar spike')"
  }
}
If the image is not food, return {"error": "not_food"}.`;

function normalizeMeal(m) {
  const num = (v, d = 0) => (typeof v === 'number' && isFinite(v) ? Math.round(v) : d);
  const str = (v, max, d = '') => String(v ?? d).slice(0, max);
  const verdict = ['Healthy', 'Moderate', 'Indulgent'].includes(m.verdict) ? m.verdict : 'Moderate';
  const cookingMethods = ['deep-fried','shallow-fried','tempered','tandoor','steamed','boiled','raw','restaurant-style','home-style','street-food','mixed'];
  const cookingMethod = cookingMethods.includes(m.cooking_method) ? m.cooking_method : 'mixed';

  const rawComponents = Array.isArray(m.components) ? m.components.slice(0, 8) : [];
  const components = rawComponents.map(c => ({
    name: str(c?.name, 50, 'Component'),
    portion: str(c?.portion, 30, ''),
    calories_kcal: num(c?.calories_kcal),
    fats_g: num(c?.fats_g),
    notes: str(c?.notes, 80, ''),
  })).filter(c => c.name);

  const ss = m.smart_swap && typeof m.smart_swap === 'object' ? m.smart_swap : null;
  const smart_swap = ss ? {
    instead_of: str(ss.instead_of, 80, ''),
    swap_to: str(ss.swap_to, 120, ''),
    why: str(ss.why, 120, ''),
  } : null;

  return {
    name: str(m.name, 60, 'Meal'),
    description: str(m.description, 100, ''),
    cooking_method: cookingMethod,
    hidden_oil_tsp: num(m.hidden_oil_tsp),
    components,
    calories_kcal: num(m.calories_kcal),
    carbs_g: num(m.carbs_g),
    fiber_g: num(m.fiber_g),
    protein_g: num(m.protein_g),
    fats_g: num(m.fats_g),
    saturated_fats_g: num(m.saturated_fats_g),
    verdict,
    verdict_reason: str(m.verdict_reason, 90, ''),
    suggestion: str(m.suggestion, 220, 'Stay mindful of portions.'),
    smart_swap: smart_swap && (smart_swap.instead_of || smart_swap.swap_to) ? smart_swap : null,
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

  const { image_base64, mime_type, profile } = req.body || {};
  if (!image_base64 || typeof image_base64 !== 'string') {
    return res.status(400).json({ error: 'image_base64_required' });
  }

  // Build profile context block. Trusted-input wise: client sends, server
  // validates shape and clamps strings before injecting into the prompt.
  const profileLines = (() => {
    if (!profile || typeof profile !== 'object') return null;
    const goals = Array.isArray(profile.goals) ? profile.goals.slice(0, 6).map(String) : [];
    const conds = Array.isArray(profile.conditions) ? profile.conditions.slice(0, 6).map(String) : [];
    const veg = profile.is_vegetarian === true ? 'vegetarian'
      : profile.is_vegetarian === false ? 'non-vegetarian' : null;
    const out = [];
    if (goals.length) out.push(`Goals: ${goals.join(', ').slice(0, 200)}`);
    if (conds.length) out.push(`Conditions: ${conds.join(', ').slice(0, 200)}`);
    if (veg) out.push(`Diet: ${veg}`);
    return out.length ? out.join(' · ') : null;
  })();
  const PROFILE_CONTEXT = profileLines
    ? `The user has shared: ${profileLines}. Make the Smart Swap match these — e.g., low-GI for diabetes, iron+folate-rich for pregnancy, no meat/fish for vegetarian, lower sodium for high BP. If the meal directly contradicts a condition (e.g. deep-fried for a diabetic), call it out gently in verdict_reason.`
    : 'No user profile shared — give a generally healthier swap suited to typical Indian palates.';

  const finalPrompt = ANALYZE_PROMPT.replace('{PROFILE_CONTEXT}', PROFILE_CONTEXT);
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
        { text: finalPrompt },
        { inline_data: { mime_type: mime, data: b64 } },
      ],
    }],
    generationConfig: {
      temperature: 0.35,
      responseMimeType: 'application/json',
      maxOutputTokens: 2048,
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
