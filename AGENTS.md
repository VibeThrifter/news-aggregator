# Agent Handbook – 360° Nieuwsaggregator

This repository already contains the canonical planning material you must follow. Always consult these documents before starting any task:

| Document | Purpose |
| -------- | ------- |
| `docs/PRD.md` | Product scope, feature set, success metrics. |
| `docs/context-events.md` | Detailed event-detection algorithm specification. |
| `docs/architecture.md` | Technical blueprint, tech stack, coding standards, project structure. |
| `docs/stories/stories.md` | Authoritative backlog; each story is self-contained and ready for execution. |

## Operating Principles

1. **Execute the stories verbatim.** Every implementation task must originate from `docs/stories/stories.md`. Follow the story order unless the user reprioritises.
2. **Stay architecture compliant.** Use the modules, patterns, and standards defined in `docs/architecture.md` (e.g., repository pattern, FastAPI layout, linting stack). When in doubt, prefer the architecture over legacy snippets.
3. **Preserve modularity.** Keep LLM clients, feed readers, and vector index logic behind the adapters described in the architecture so that providers can be swapped easily.
4. **Respect coding/testing rules.** PEP 8 with type hints, `ruff` + `black` for Python, strict TypeScript + ESLint/Prettier for the frontend, pytest coverage ≥80%, Playwright for UI flows.
5. **Log and handle errors consistently.** Use the structured logging strategy (`structlog`, correlation IDs) and the error response format defined in the architecture.

## Implementation Workflow

1. **Select a story** from `docs/stories/stories.md`.
2. **Review referenced sections** in the PRD, architecture, and context documents to internalise requirements.
3. **Follow the story checklist** step by step. Include mandatory MANUAL STEP notes in your handoff response.
4. **Write code/tests** inside the paths specified (e.g., `backend/app/...`, `frontend/app/...`).
5. **Run the required tests** (unit, integration, Playwright, linting) indicated in the story.
6. **Update docs or configuration** when the story instructs you to do so.
7. **Report completion** referencing the acceptance criteria and test evidence.

## Delivery Expectations

- Backend work lives under `backend/` and adheres to the modular monolith layout (ingest, NLP, events, LLM, repositories, API). Use SQLite + SQLAlchemy, hnswlib, APScheduler, etc., as defined.
- Frontend work uses Next.js App Router with Tailwind styling, components under `frontend/components/`, and data fetching via the API helpers in `frontend/lib/api.ts`.
- Data outputs (CSV exports, vector index, logs) must go into the `data/` folder structure described in the architecture.
- Every new module requires matching unit or integration tests plus updates to CI configuration when relevant.

## Quality and CI

- Run `make lint`, `make test`, and any story-specific commands before handing off.
- Ensure GitHub Actions (`.github/workflows/ci.yml`) stays green; update it if dependencies or commands change per story instructions.
- Keep the repository documentation (`README.md`, `docs/`) consistent with the delivered functionality.

## Communication Back to User

When finishing a story:
- Reference the story ID and acceptance criteria you satisfied.
- List commands/tests executed with their outcomes.
- Call out any MANUAL STEP the user must still perform (API keys, external provisioning).
- Note follow-up work if new risks or gaps were discovered.

Stay aligned with these documents and the backlog, and this MVP will remain robust, modular, and ready to scale.
