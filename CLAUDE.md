# Claude Code Guide - News Aggregator Project

This document provides Claude Code with essential context and guidelines for working on the 360° News Aggregator project.

## 📋 Project Overview

A proof-of-concept news aggregation system that demonstrates pluralistic news consumption through:
- **Multi-source ingestion** (NOS, NU.nl RSS feeds)
- **Event detection** using hybrid ML approach (embeddings + TF-IDF + entities)
- **Bias analysis** with LLM-powered insights
- **Interactive web interface** for exploring news events and viewpoints

## 📚 Essential Documentation

Always consult these canonical documents before starting any task:

| Document | Purpose | When to Reference |
| -------- | ------- | ---------------- |
| `docs/PRD.md` | Product scope, features, success metrics | Planning & feature decisions |
| `docs/architecture.md` | Tech stack, patterns, project structure | Implementation & design |
| `docs/context-events.md` | Event detection algorithm specification | ML/NLP work |
| `docs/stories/stories.md` | **Authoritative backlog** with ready-to-execute stories | Primary task source |
| `docs/ML_SETUP.md` | Machine learning dependencies setup | When adding PyTorch/transformers |

## 🛠 Current Technical Setup

### Backend (Python 3.12)
- **Framework**: FastAPI with Uvicorn
- **Database**: SQLite with SQLAlchemy ORM
- **Dependencies**: venv + pip with `requirements.txt`
- **ML Status**: PyTorch/sentence-transformers **temporarily removed** due to Python 3.12 compatibility
- **Testing**: pytest with coverage target ≥80%

### Frontend (Next.js 14)
- **Framework**: Next.js App Router
- **Styling**: Tailwind CSS 3.4
- **Components**: React 18 with TypeScript
- **Testing**: Playwright for E2E tests

### Development Tools
- **Build System**: Comprehensive Makefile with all dev targets
- **Linting**: ruff + black (Python), ESLint (JavaScript/TypeScript)
- **Environment**: `.env.example` → `.env` for configuration
- **Utility scripts**: `/scripts/test_rss_feeds.py` voor snelle feedchecks; voeg nieuwe helpers in dezelfde map toe

## ⚙️ Quick Start Commands

```bash
# Setup everything
make setup              # Install both backend and frontend dependencies

# Development servers
make backend-dev        # Start backend on http://localhost:8000
make frontend-dev       # Start frontend on http://localhost:3000
make dev               # Start both servers

# Testing & Quality
make test              # Run backend tests
make lint              # Run linting for both backend and frontend
make validate          # Verify current setup is working

# Utilities
make help              # Show all available commands
make clean             # Clean up generated files
```

## 📝 Implementation Guidelines

### 1. Story-Driven Development
- **Primary source**: All tasks must originate from `docs/stories/stories.md`
- **Follow order**: Execute stories in sequence unless user reprioritizes
- **Complete checklists**: Each story has detailed subtask checkboxes to follow
- **Update status**: Mark subtasks as completed and fill in "Story Wrap Up" sections

### 2. Architecture Compliance
- **Module structure**: Follow the repository pattern and modular monolith layout
- **Path conventions**:
  - Backend: `backend/app/` (services, routers, models, core)
  - Frontend: `frontend/app/` and `frontend/components/`
  - Data: `data/` (exports, models, cache)
- **Provider abstraction**: Keep LLM clients, feed readers, vector indices behind adapters for easy swapping

### 3. Code Quality Standards
- **Python**: PEP 8 + type hints, ruff + black formatting, pytest coverage ≥80%
- **TypeScript**: Strict mode + ESLint/Prettier, Playwright for E2E tests
- **Logging**: Structured logging with structlog and correlation IDs
- **Error handling**: Consistent error response format per architecture

### 4. Testing Requirements
- **Unit tests**: For all business logic and services
- **Integration tests**: For API endpoints and database operations
- **E2E tests**: For critical user workflows
- **Coverage**: Maintain ≥80% coverage target
- **CI**: Ensure GitHub Actions stay green

## 🔧 Development Workflow

### Starting a Story
1. **Read the story** completely in `docs/stories/stories.md`
2. **Review references** in PRD, architecture, and context documents
3. **Check prerequisites** (dependencies, previous stories)
4. **Plan implementation** following the story's subtask checklist

### During Implementation
1. **Create branches** for significant features
2. **Follow TDD** where appropriate (write tests first)
3. **Test frequently** using `make validate`, `make test`, `make lint`
4. **Update documentation** when stories require it
5. **Respect module boundaries** defined in architecture

### Completing a Story
1. **Verify acceptance criteria** are all satisfied
2. **Run full test suite** (`make test`, `make lint`)
3. **Update story status** (mark subtasks complete, fill wrap-up section)
4. **Report to user** with story ID, completed ACs, test outcomes
5. **Note manual steps** user must perform (API keys, etc.)

## 🚨 Important Notes

### Current Status
- **Backend**: Fully functional with Python 3.12 + venv + SQLite database
- **Frontend**: Next.js 14 fully implemented with dark mode UI
- **ML Features**: Temporarily disabled (PyTorch compatibility) - using fallback embeddings
- **Database**: SQLite with WAL mode, Alembic migrations configured
- **LLM Classification**: **NEW** - Mistral-based semantic event type classification (replaced keyword matching)
- **Clustering Performance**: **IMPROVED** - 32.0% clustering rate (2.16x improvement from 14.78% baseline)
- **LLM Insights**: Auto-generation working with Mistral API, narrative summaries included
- **REST API**: Full JSON:API-lite endpoints for events and insights
- **Event Detail**: Complete detail pages with timeline, clusters, contradictions, fallacies

### What NOT to Do
- ❌ Don't install Poetry (project uses venv + pip)
- ❌ Don't add PyTorch dependencies without checking ML_SETUP.md
- ❌ Don't create features outside the story backlog
- ❌ Don't skip testing requirements
- ❌ Don't commit secrets or API keys

### When to Ask for Help
- If story requirements conflict with current setup
- If you need credentials or external API access
- If tests are failing due to missing dependencies
- If architecture decisions need clarification

## 📁 Key File Locations

```
├── docs/
│   ├── PRD.md                    # Product requirements
│   ├── architecture.md          # Technical blueprint
│   ├── context-events.md         # Event detection spec
│   └── stories/stories.md        # **PRIMARY TASK SOURCE**
├── backend/
│   ├── app/                     # Main application code
│   └── tests/                   # Test suites
├── frontend/                    # Next.js application
├── scripts/                     # CLI helpers (RSS probe, smoke tests)
├── data/                        # Exports, models, cache
├── requirements.txt             # Python dependencies
├── .env.example                 # Environment template
├── Makefile                     # Development commands
└── CLAUDE.md                    # **THIS FILE**
```

## 🎯 Success Criteria

- Stories completed according to acceptance criteria
- Tests passing with ≥80% coverage
- Code follows architecture patterns and quality standards
- Documentation stays current with implemented features
- User can run `make setup` → `make dev` → functional application

---

**Remember**: This is a proof-of-concept demonstrating pluralistic news analysis. Focus on working functionality over optimization, but maintain good architecture for future scaling.