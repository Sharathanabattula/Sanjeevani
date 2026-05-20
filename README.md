# Sanjeevani

AI-powered health ecosystem — landing site built from the project pitch deck.

## Run locally

```bash
node serve.js
```

Then open <http://localhost:3001>.

## Structure

- `index.html` — the full landing page
- `serve.js` — minimal static-file server on port 3001
- `Sanjeevani_Project_Pitch_Deck.pdf` — source pitch deck

## Stop the server

```bash
lsof -ti:3001 | xargs kill -9
```
