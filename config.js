// Public config — safe to commit. Loaded by every visitor.
// The Supabase URL and publishable key are designed to be public
// (RLS protects your data). Do NOT add secret keys here.
//
// Local development can override these by also providing config.local.js
// (gitignored) — for example to add a personal Gemini API key for testing.
window.SANJEEVANI_CONFIG = Object.assign({
  // === Supabase (cloud sync + Google sign-in) ===
  supabaseUrl: 'https://ueiikifkmutwxweuberr.supabase.co',
  supabaseKey: 'sb_publishable_CCWBxmiMEwPpewM4svJMvA_LF3GyqAW',

  // === Gemini ===
  // No client-side key in production — the browser calls /api/gemini-chat
  // (Vercel serverless function) which holds the secret key as an env var.
  geminiModel: 'gemini-flash-latest',

  // === Waitlist ===
  waitlistBaseCount: 12847,
}, window.SANJEEVANI_CONFIG || {});
