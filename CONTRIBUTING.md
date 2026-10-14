# Contributing

Thanks for helping make AI Marketing Manager better! Bug reports, new export column aliases, better playbook
advice, new tools and prompts are all welcome.

## Ground rules

Read [ARCHITECTURE.md](ARCHITECTURE.md) and [CLAUDE.md](CLAUDE.md) first. In short:

- **The server supplies facts, Claude supplies judgment.** Tools return structured JSON; the server never calls an LLM.
- **Read-only toward Meta.** No features that create, edit, pause or re-budget ads.
- **Honest data.** Never fabricate competitor sales; ratios come from summed counts; divide-by-zero is `null`.
- **Never write to stdout** — it belongs to the MCP stdio transport. Use `src/utils/logger.ts` (stderr).
- **Clients never mix:** each client is a project folder with its own database; tools work inside one project.
- **Layers:** `mcp/` (parse input, call a service, format output) → `services/` (orchestrate) →
  `analytics/` (pure functions) / `sources/` (external data) / `db/` (the only SQLite access).

## Setup

```bash
npm install
npm run check        # lint + typecheck + format check + tests
npm run build        # compile to dist/
npm run smoke        # start the built server over stdio and run a few tools on sample data
npm run sample       # regenerate examples/sample-meta-export.csv (deterministic)
```

Node.js ≥ 22 is required.

## Common contributions

- **An export didn't import / columns ignored:** add aliases to `FIELD_ALIASES` in
  `src/sources/metaExport/columnMap.ts` and a fixture + test in `tests/sources/metaExport.test.ts`.
  Please only share header rows, never real data.
- **Meta renamed an action type:** edit `ACTION_TYPE_MAP` in `src/sources/metaApi/insights.ts`.
- **Better marketing advice:** edit `src/mcp/resources/playbook.md`.
- **A new tool:** add it to the right `src/mcp/tools/*Tools.ts` with `defineTool` (zod schema, a one-line
  `summary` in the result, typed errors from `utils/errors.ts`), register it in `src/mcp/tools/index.ts`, add a
  test in `tests/mcp/`, and document it in the README tool table.
- **A new prompt:** add `src/mcp/prompts/<name>.ts`, register it in `src/mcp/prompts/index.ts`. The prompt test
  checks that every tool a prompt mentions exists.
- **A DB change:** add a new numbered file in `src/db/migrations/`. Never edit a migration that has shipped.

Record non-obvious decisions in [DECISIONS.md](DECISIONS.md).

## Pull requests

Keep PRs focused, run `npm run check`, and fill in the PR template. CI runs lint, typecheck, format check, tests,
build and a stdio smoke test on Node 22 and 24.
