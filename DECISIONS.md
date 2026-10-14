# Design decisions

Non-obvious choices made while building, per ARCHITECTURE.md ("choose the simplest option and note it here").

## Runtime & configuration

- **Paths resolve from the project root, not the cwd.** MCP clients (Claude Desktop) launch the server with an
  arbitrary working directory, so relative `DATA_DIR` / `BUSINESS_CONFIG` values and `.env` are resolved against
  the repo folder (two levels above `dist/config/paths.js`). Absolute paths are used as-is.
- **dotenv runs with `quiet: true`.** dotenv ≥17 prints a banner to stdout, which would corrupt the stdio transport.
- **`BUSINESS_CONFIG` env var** was added (default `./config/business.yaml`) so tests and multiple businesses can
  point at different profiles.
- **business.yaml is re-read on every tool call**, so manual edits apply without restarting the server.
- **Analytics works without business.yaml** using default thresholds (primary KPI = purchases, no targets) and a
  warning; tools that genuinely need the profile (competitors, market context, profile) return `ConfigMissingError`.
- **`update_business_profile` edits YAML through `yaml`'s Document API** so existing comments survive. Objects merge
  key by key, arrays (products, competitors) are replaced wholesale, `null` deletes a key. If the file does not exist
  it is created from the patch alone (not from the example) so example competitors never leak into a real profile.

## Database

- Migrations are plain `.sql` files applied in filename order and tracked in `schema_migrations`. The build copies
  them to `dist/` (scripts/copy-assets.mjs).
- Migration 002 adds `competitors.active` (soft delete — removing a competitor keeps its history) and
  `competitors.is_self` (the user's own brand is stored as a competitor row so the same signals/snapshots apply).
