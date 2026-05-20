// Copy this file to config.local.js and paste your free Gemini API key.
// Get a key at https://aistudio.google.com/apikey
//
// config.local.js is gitignored — never commit your real key.
window.SANJEEVANI_CONFIG = {
  // === AI (Food Scanner + Health Coach) ===
  geminiApiKey: 'YOUR_FREE_GEMINI_API_KEY_HERE',
  geminiModel: 'gemini-flash-latest',

  // === Waitlist email collection (optional) ===
  // The waitlist ALWAYS works (saves locally). Setting these adds real email
  // delivery so leads land in your inbox / sheet.
  //
  // Option A — Web3Forms (easiest, no account, free unlimited):
  //   1. Visit https://web3forms.com → enter your email → click Generate Key
  //   2. Paste below. You'll get an email per signup.
  // waitlistEndpoint: 'https://api.web3forms.com/submit',
  // web3formsKey: 'YOUR_WEB3FORMS_ACCESS_KEY',
  //
  // Option B — Formspree (https://formspree.io):
  // waitlistEndpoint: 'https://formspree.io/f/YOUR_FORM_ID',
  //
  // Option C — your own webhook (Zapier, n8n, Pipedream, custom):
  // waitlistEndpoint: 'https://your.endpoint/waitlist',

  // Social-proof baseline (added to actual count for the "X people in line" message)
  waitlistBaseCount: 12847,

  // === Supabase (cloud sync + Google sign-in) ===
  // Get these from your Supabase project: Settings → API.
  //   - URL is your project URL (https://xxxxx.supabase.co).
  //   - Key is the PUBLISHABLE key (browser-safe). DO NOT paste the secret one.
  // supabaseUrl: 'https://YOUR_PROJECT_ID.supabase.co',
  // supabaseKey: 'sb_publishable_XXXXXXXXXXXXXXXXXXXX',
};
