英語で think して、日本語で output してください
# Repository Guidelines

## Project Structure & Module Organization
- `src/` — Vue 3 client (TypeScript, SFCs). Entry: `src/main.ts`, root SFC: `src/App.vue`.
- `server/` — Express API in TypeScript. Entry: `server/index.ts`, routes in `server/routes/`.
- `dist/` — Client build output (Vite). Do not edit.
- Config: `vite.config.ts`, `eslint.config.mjs`, `tailwind.config.cjs`, `tsconfig*.json`.
- Secrets: `.env` (not committed). Required: `OPENAI_API_KEY`, `GEMINI_API_KEY`.

## Build, Test, and Development Commands
- `yarn dev` — Run API (tsx) and Vite dev server concurrently.
- `yarn dev:client` / `yarn dev:server` — Run client or server only.
- `yarn build` — Type-check client, build client, compile server TS.
- `yarn preview` — Serve the built client locally.
- `yarn start` — Run server in production mode (expects built artifacts).
- `yarn lint` — Lint `src/` and `server/` with ESLint.
- `yarn format` — Format code with Prettier.
(Use `npm run <script>` if you prefer npm.)

## Coding Style & Naming Conventions
- TypeScript strict mode; 2-space indentation; Unix line endings; semicolons required.
- Linting via ESLint + TypeScript + SonarJS; formatting via Prettier. CI should fail on lint errors.
- Vue SFCs: `PascalCase.vue` (e.g., `ChatPanel.vue`). Modules: `kebab-case.ts` where reasonable.
- Avoid `console.*` in committed code; prefer structured logging helpers.

## Testing Guidelines
- No test suite is configured yet. If adding tests:
  - Client: Vitest + Vue Test Utils; Server: Vitest or Jest + supertest.
  - Name files `*.spec.ts` near sources (e.g., `src/components/Thing.spec.ts`).
  - Aim for meaningful coverage on routes and critical UI logic.

## Commit & Pull Request Guidelines
- History favors short, imperative messages (e.g., “add route guard”). Prefer Conventional Commits where possible: `feat:`, `fix:`, `chore:`, `refactor:`.
- PRs should include: clear intent, linked issues, setup/repro steps, and screenshots or logs when UI/API behavior changes.
- Keep PRs focused and small; run `yarn lint && yarn format` before pushing.

## Security & Configuration Tips
- Never commit secrets. Use `.env` locally and deployment env vars in production.
- The `/api/start` route currently contains a temporary key handling hack; do not ship this to production.
