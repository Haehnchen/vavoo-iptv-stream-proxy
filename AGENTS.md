# AGENTS.md

## Project
- Node.js proxy for VAVOO IPTV streams.
- Main entry point: `index.js`

## Rules
- Keep changes small and focused.
- Do not break existing HTTP endpoints:
  - `GET /channels.m3u8`
  - `GET /countries`
  - `GET /stream/:id`
- Prefer simple Node.js code and existing project style.
- Update `README.md` if CLI options or endpoints change.

## Before Finishing
- Run a quick syntax check or start test if relevant.
- Verify the server still starts with `node index.js`.
