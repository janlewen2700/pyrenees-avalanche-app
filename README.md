# Pyrenees Avalanche Network — v3.2

A cross-border avalanche-safety prototype combining official warning regions and bulletins, community field observations, snow/weather history and a mobile-first map interface.

## What changed in v3.2

- Full operational localization for Catalan, Spanish, French, German, Italian and English.
- The language switch now translates Pages 1, 2 and 4, the report workflow, form options, popups, dynamic status messages, report previews, weather chart labels and mobile controls.
- Page 3 (Learn & Rescue) intentionally remains in English for now. Its safety-critical educational text should be reviewed by competent native avalanche educators before publication in each language.
- Select option display text is translated while canonical stored values remain language-independent, so changing language does not change the observation schema.
- Language choice persists in `localStorage`.
- Restored the full weather-history and current-weather backend routes that were accidentally lost during the v3.1 region-routing patch.
- Retains v3.1 point-in-polygon bulletin resolution for French, Spanish, Andorran and Catalan warning regions.
- Retains strong black warning-region boundaries and the mobile bottom-drawer interface.
- Added `PARTNER_PITCH.md`, a starting draft for collaboration with warning services and EAWS.

## Run locally

```bash
npm install
npm start
```

Open `http://localhost:3000`.

Run static checks with:

```bash
npm run check
```

## Storage

For durable production observations set `DATABASE_URL` to a PostgreSQL/PostGIS database. Without it, the app uses the local JSON fallback in `data/observations.json`, which is useful for local testing but should not be treated as durable storage on an ephemeral hosting service.

## Translation architecture

`translations.js` contains the operational UI dictionaries. English remains the canonical value for saved observation enums such as avalanche character, trigger and stability-test result. Only the displayed text changes.

When adding a new user-visible operational string:

1. add its English source text to the relevant HTML/JavaScript;
2. add the same source key to every language in `translations.js`;
3. for dynamically generated JavaScript text, render it through `t(...)`;
4. do not translate user-authored report notes automatically.

The Learn & Rescue page is deliberately excluded from automatic UI translation so safety education can be translated and reviewed as a separate editorial process.

## Open-source direction

A licence has not been imposed in this prototype. Before public collaboration, choose the project governance and licensing deliberately. An adoption-friendly starting point would be a permissive code licence such as Apache-2.0, with the observation schema/API documentation openly published. If reciprocal public-sector licensing is preferred, EUPL-1.2 is worth evaluating. Observation data needs its own terms, privacy rules and contributor consent rather than automatically inheriting the software licence.
