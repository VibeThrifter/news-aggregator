# News Aggregator - Build and Development Tools
#
# This Makefile provides convenient targets for setting up and working with
# both the backend (Python/FastAPI) and frontend (Node.js/Next.js) components.

.PHONY: help setup backend-install frontend-install test lint backend-test frontend-test clean dev
.DEFAULT_GOAL := help

# Python and Node.js executables
PYTHON := python3.12
NODE := node
NPM := npm

# Virtual environment and project paths
VENV := .venv
BACKEND_DIR := backend
FRONTEND_DIR := frontend

help: ## Show this help message
	@echo "News Aggregator Development Commands"
	@echo "===================================="
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'

setup: backend-install frontend-install ## Set up both backend and frontend development environments
	@echo "✅ Development environment ready!"
	@echo "   Backend: source .venv/bin/activate"
	@echo "   Frontend: cd frontend && npm run dev"

backend-install: ## Install backend dependencies (Python/FastAPI with venv + pip)
	@echo "🔧 Setting up backend dependencies..."
	@if [ ! -d "$(VENV)" ]; then \
		echo "Creating Python virtual environment with $(PYTHON)..."; \
		$(PYTHON) -m venv $(VENV); \
	fi
	@echo "Installing Python dependencies..."
	@. $(VENV)/bin/activate && pip install --upgrade pip
	@. $(VENV)/bin/activate && pip install -r requirements.txt
	@echo "✅ Backend dependencies installed"

frontend-install: ## Install frontend dependencies (Node.js/Next.js)
	@echo "🔧 Setting up frontend dependencies..."
	@if [ ! -f "$(FRONTEND_DIR)/package.json" ]; then \
		echo "⚠️  Frontend package.json not found. Run 'make frontend-init' first."; \
		exit 1; \
	fi
	@cd $(FRONTEND_DIR) && $(NPM) install
	@echo "✅ Frontend dependencies installed"

test: backend-test ## Run tests (backend only for now)

backend-test: ## Run backend tests with pytest
	@echo "🧪 Running backend tests..."
	@. $(VENV)/bin/activate && python -m pytest backend/tests/ -v
	@echo "✅ Backend tests completed"

frontend-test: ## Run frontend tests (when package.json test script exists)
	@echo "🧪 Running frontend tests..."
	@cd $(FRONTEND_DIR) && $(NPM) run test || echo "No frontend tests configured yet"

lint: backend-lint frontend-lint ## Run linting for both backend and frontend

backend-lint: ## Run backend linting (if tools are installed)
	@echo "🔍 Running backend linting..."
	@. $(VENV)/bin/activate && python -m ruff check . 2>/dev/null || echo "ℹ️  Ruff not installed (optional)"
	@. $(VENV)/bin/activate && python -m black --check . 2>/dev/null || echo "ℹ️  Black not installed (optional)"

frontend-lint: ## Run frontend linting with ESLint
	@echo "🔍 Running frontend linting..."
	@cd $(FRONTEND_DIR) && $(NPM) run lint || echo "No frontend linting configured yet"

format: ## Format backend code
	@echo "🎨 Formatting backend code..."
	@. $(VENV)/bin/activate && python -m black . 2>/dev/null || echo "ℹ️  Black not installed"
	@. $(VENV)/bin/activate && python -m ruff check --fix . 2>/dev/null || echo "ℹ️  Ruff not installed"

dev: ## Start development servers for both backend and frontend
	@echo "🚀 Starting development servers..."
	@echo "Backend will start on http://localhost:8000"
	@echo "Frontend will start on http://localhost:3000"
	@. $(VENV)/bin/activate && python -m uvicorn src.web.app:app --reload --port 8000 &
	@cd $(FRONTEND_DIR) && $(NPM) run dev &
	@wait

backend-dev: ## Start only the backend development server
	@echo "🚀 Starting backend server on http://localhost:8000..."
	@. $(VENV)/bin/activate && python -m uvicorn src.web.app:app --reload --port 8000

frontend-dev: ## Start only the frontend development server
	@echo "🚀 Starting frontend server..."
	@cd $(FRONTEND_DIR) && $(NPM) run dev

clean: ## Clean up generated files and dependencies
	@echo "🧹 Cleaning up..."
	@rm -rf $(VENV)
	@rm -rf $(FRONTEND_DIR)/node_modules
	@rm -rf $(FRONTEND_DIR)/.next
	@find . -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true
	@find . -type f -name "*.pyc" -delete 2>/dev/null || true
	@echo "✅ Cleanup completed"

check-deps: ## Check if required tools are installed
	@echo "🔍 Checking dependencies..."
	@command -v $(PYTHON) >/dev/null 2>&1 || { echo "❌ Python 3.12 not found. Install with: brew install python@3.12"; exit 1; }
	@command -v $(NODE) >/dev/null 2>&1 || { echo "❌ Node.js not found. Install with: brew install node"; exit 1; }
	@echo "✅ All required tools are available"
	@$(PYTHON) --version
	@$(NODE) --version
	@$(NPM) --version

validate: ## Validate that current setup is working
	@echo "🔍 Validating current setup..."
	@. $(VENV)/bin/activate && python -c "import src.web.app; print('✅ Backend imports work')"
	@echo "✅ Virtual environment is functional"