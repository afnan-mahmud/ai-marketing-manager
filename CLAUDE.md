# Rules for working on this repo

- Read ARCHITECTURE.md first. Build phases in order; meet each phase's "Done when".
- Server never calls an LLM. Tools return structured JSON facts; Claude does the reasoning.
- Never write to stdout (stdio transport). Use utils/logger.ts (stderr).
- analytics/ = pure functions, fully unit-tested. db/ is the only SQLite access.
- Ratios are computed from summed counts, never averaged. Divide-by-zero → null.
- Read-only toward Meta. Never add ad-editing features.
- Never fabricate competitor sales; positioning is an estimate from observable signals.
- Every new tool: zod schema, error mapping, a test, and a README entry.
- Record non-obvious choices in DECISIONS.md.

## Commands

- `npm run build` — compile to dist/ (also copies .sql/.md assets)
- `npm test` — vitest
- `npm run lint` / `npm run typecheck` / `npm run format:check`

## Where things go

- New tool: `src/mcp/tools/<group>Tools.ts` (use `defineTool`), add to `src/mcp/tools/index.ts`.
- New prompt: `src/mcp/prompts/<name>.ts`, add to `src/mcp/prompts/index.ts`.
- New DB change: new numbered file in `src/db/migrations/` — never edit an applied migration.
