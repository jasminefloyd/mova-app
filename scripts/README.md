# scripts

Planned (spec §3.2): `verify-phase.mjs` (phase gate), `check-locales.mjs` (i18n parity + critical strings), `render-public-pages.mjs`,
`generate-sitemap.mjs`, `validate-seo.mjs`, `run-ai-evals.mjs`.

`design/` holds the tools that regenerated `docs/design/screens` from the canvas export (`export_design.py` → reference HTML,
`shoot.js` → PNG renders with Playwright, `screen_map.py` → `SCREEN_MAP.md`). Input is the canvas `project/` folder (the `.dc.html` artboards and `canvas.json`).
