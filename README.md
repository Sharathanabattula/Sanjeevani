# Sanjeevani

AI-powered health ecosystem. A landing site built from the project pitch deck, with a working AI Food Scanner prototype (camera + Gemini 1.5 Flash Vision) and a localStorage-backed state engine.

## Run locally

```bash
node serve.js
```

Open <http://localhost:3001>.

## AI Food Scanner

Click **Scan a Meal** in the Food Scanner section. Two input modes:

- **Camera** — uses `getUserMedia` (the browser asks for permission once)
- **Upload** — pick a photo from disk

The captured frame is sent to the Gemini Vision API (model `gemini-1.5-flash-latest`) which returns structured JSON: dish name, calories, macros, verdict, and a one-line suggestion. Results render straight into the scanner card and are saved to `localStorage` for the meal-history view.

### Configuring the API key (free)

1. Get a free key at <https://aistudio.google.com/apikey>
2. Copy the example config:
   ```bash
   cp config.example.js config.local.js
   ```
3. Edit `config.local.js` and paste your key into `geminiApiKey`.

`config.local.js` is gitignored — your key never leaves your machine. Without a key the scanner runs in **demo mode** with realistic sample data.

## State engine

A small JS module (`SANJEEVANI` in `index.html`) wraps `localStorage` under the key `sanjeevani.state.v1`. Public methods:

- `SANJEEVANI.logMeal(meal)` — append a meal, keep last 50
- `SANJEEVANI.loadState()` / `saveState(s)` / `patchState({...})`
- `SANJEEVANI.clearMeals()`
- `SANJEEVANI.toast(msg)`

These are the hooks the AI Coach and Dashboard features will plug into next.

## Structure

- `index.html` — the full landing page + Food Scanner UI + engine
- `config.example.js` — copy → `config.local.js` and paste your key
- `serve.js` — minimal static-file server on port 3001
- `Sanjeevani_Project_Pitch_Deck.pdf` — source pitch deck

## Stop the server

```bash
lsof -ti:3001 | xargs kill -9
```
