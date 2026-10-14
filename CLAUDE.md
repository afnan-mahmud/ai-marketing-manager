# Rules for working on this repo

- Read ARCHITECTURE.md first. Build phases in order; meet each phase's "Done when".
- Server never calls an LLM. Tools return structured JSON facts; Claude does the reasoning.
- Never write to stdout (stdio transport). Use utils/logger.ts (stderr).
- analytics/ = pure functions, fully unit-tested. db/ is the only SQLite access.
- Ratios are computed from summed counts, never averaged. Divide-by-zero → null.
- Meta changes ONLY via propose → explicit user confirmation → execute (services/adManagerService.ts). Never
  auto-execute, never add a change path that skips the pending-action + confirmation flow. Off per project unless
  META_WRITE_ENABLED=true; always verify the target belongs to the project's ad account.
- Memory: the server never invents lessons. Claude records them (record_learning) from data; the server merges,
  ranks and reports outcomes. Lessons live in the client's project DB only.
- Never fabricate competitor sales; positioning is an estimate from observable signals.
- Multi-client: everything about a client lives in its project (`projects/<slug>/`, its own DB). Project tools get
  an `AppContext` for one project and must never read another project's data. Never inherit a client's ad account.
- Every new tool: zod schema, error mapping, a test, and a README entry.
- Record non-obvious choices in DECISIONS.md.

## Commands

- `npm run build` — compile to dist/ (also copies .sql/.md assets)
- `npm test` — vitest
- `npm run lint` / `npm run typecheck` / `npm run format:check`

## Where things go

- New tool: `src/mcp/tools/<group>Tools.ts` (use `defineTool`; it gets the optional `project` arg automatically), add to
  `src/mcp/tools/index.ts`. Workspace-level tools (managing projects) use `defineWorkspaceTool` in `workspaceTools.ts`.
- New prompt: `src/mcp/prompts/<name>.ts`, add to `src/mcp/prompts/index.ts`.
- New DB change: new numbered file in `src/db/migrations/` — never edit an applied migration.
