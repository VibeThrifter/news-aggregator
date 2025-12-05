# Installation Guide - News Aggregator

This guide provides step-by-step instructions for setting up the 360° News Aggregator on your local machine.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [System Requirements](#system-requirements)
3. [Installation Steps](#installation-steps)
4. [Configuration](#configuration)
5. [Running the Application](#running-the-application)
6. [Troubleshooting](#troubleshooting)
7. [Common Issues](#common-issues)

---

## Prerequisites

Before starting, ensure you have the following:

- **macOS** (this guide is tailored for macOS, but can be adapted for Linux)
- **Homebrew** package manager
- **Git** for version control
- **Node.js** 18+ and npm (for frontend)
- **Supabase account** (free tier works)

## System Requirements

- **Python**: 3.11.x (managed via pyenv)
- **Node.js**: 18+
- **Memory**: Minimum 4GB RAM (8GB recommended for ML models)
- **Disk Space**: ~2GB for dependencies and ML models
- **Network**: IPv4 or IPv6 connectivity

---

## Installation Steps

### 1. Install System Dependencies

#### Install Homebrew (if not already installed)

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

#### Install pyenv for Python version management

```bash
brew install pyenv
```

Add pyenv to your shell configuration:

```bash
# For zsh (default on macOS)
echo 'export PYENV_ROOT="$HOME/.pyenv"' >> ~/.zshrc
echo 'command -v pyenv >/dev/null || export PATH="$PYENV_ROOT/bin:$PATH"' >> ~/.zshrc
echo 'eval "$(pyenv init -)"' >> ~/.zshrc

# Reload shell
source ~/.zshrc
```

For bash, use `~/.bash_profile` or `~/.bashrc` instead.

### 2. Clone the Repository

```bash
cd ~/Workspace  # Or your preferred directory
git clone <repository-url> news-aggregator
cd news-aggregator
```

### 3. Install Python 3.11

```bash
# Install Python 3.11.10
pyenv install 3.11.10

# Set it as the local version for this project
pyenv local 3.11.10

# Verify installation
python --version  # Should show Python 3.11.10
```

### 4. Set Up Python Virtual Environment

```bash
# Create virtual environment
python -m venv .venv

# Activate virtual environment
source .venv/bin/activate

# Upgrade pip
pip install --upgrade pip
```

### 5. Install Python Dependencies

```bash
# Install all backend dependencies
pip install -r requirements.txt

# Install greenlet (required for SQLAlchemy async operations)
pip install greenlet
```

**Note**: This step may take 5-10 minutes as it downloads and installs PyTorch, spaCy, and other ML libraries.

### 6. Install Frontend Dependencies

```bash
cd frontend
npm install
cd ..
```

### 7. Download spaCy Language Model

**IMPORTANT**: This step is required for the NLP features to work (entity extraction, text processing).

```bash
# Download Dutch language model for spaCy (568 MB, takes 5-10 minutes)
python -m spacy download nl_core_news_lg

# Verify installation
python -c "import spacy; nlp = spacy.load('nl_core_news_lg'); print('spaCy model installed successfully')"
```

**Note**: This downloads a 568MB model for Dutch language processing. Without it, article enrichment will fail.

---

## Configuration

### 1. Set Up Supabase Database

1. **Create a Supabase account** at [supabase.com](https://supabase.com)
2. **Create a new project**
3. **Get your database credentials**:
   - Go to **Project Settings → Database**
   - Find **Connection String** section
   - **Important**: Use the **Session Pooler** connection string (not Direct Connection)
   - The Session Pooler string looks like:
     ```
     postgresql://postgres.<project-ref>:<password>@aws-0-eu-central-1.pooler.supabase.com:5432/postgres
     ```

### 2. Configure Environment Variables

#### Backend Configuration

Copy the example environment file:

```bash
cp .env.example .env
```

Edit `.env` and update the following key settings:

```bash
# === Database Configuration ===
# IMPORTANT: Use Session Pooler URL for IPv4 compatibility
DATABASE_URL=postgresql+asyncpg://postgres.<your-project-ref>:<your-password>@aws-X-region.pooler.supabase.com:5432/postgres

# === LLM Credentials ===
# Get your API key from https://console.mistral.ai
MISTRAL_API_KEY=your_mistral_api_key_here

# === RSS Feeds ===
RSS_NOS_URL=https://feeds.nos.nl/nosnieuwsalgemeen
RSS_NUNL_URL=https://www.nu.nl/rss/Algemeen

# === Scheduler ===
SCHEDULER_INTERVAL_MINUTES=15
```

**Critical**: Always use the **Session Pooler** connection string from Supabase, not the direct connection. The direct connection uses IPv6 and may not work on all networks.

#### Frontend Configuration

Create `frontend/.env.local`:

```bash
cd frontend
cp .env.example .env.local
```

Edit `frontend/.env.local`:

```bash
# Supabase Configuration
NEXT_PUBLIC_SUPABASE_URL=https://<your-project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key_here

# API Configuration (for local development)
NEXT_PUBLIC_API_BASE_URL=http://localhost:8000
```

You can find your Supabase URL and anon key in:
**Project Settings → API → Project URL** and **Project API keys → anon public**

### 3. Initialize Database Schema

The database schema will be automatically created when you first start the backend. However, you can manually initialize it:

```bash
# Activate virtual environment if not already active
source .venv/bin/activate

# Run database initialization (optional, auto-runs on startup)
PYTHONPATH=/Users/<your-username>/Workspace/news-aggregator python -c "
import asyncio
from backend.app.db.session import init_db
asyncio.run(init_db())
"
```

---

## Running the Application

### Option 1: Using Make (Recommended)

The project includes a Makefile with convenient commands:

```bash
# Start both frontend and backend
make dev

# Or start them separately:
make backend-dev  # Backend on http://localhost:8000
make frontend-dev # Frontend on http://localhost:3000 (or 3001 if 3000 is busy)
```

### Option 2: Manual Start

#### Start Backend

```bash
# From project root
source .venv/bin/activate
PYTHONPATH=/Users/<your-username>/Workspace/news-aggregator .venv/bin/uvicorn backend.app.main:app --host 0.0.0.0 --port 8000 --reload
```

The backend will be available at: **http://localhost:8000**

API documentation: **http://localhost:8000/docs**

#### Start Frontend

In a new terminal:

```bash
cd frontend
npm run dev
```

The frontend will be available at: **http://localhost:3000** (or 3001 if 3000 is in use)

### Verify Installation

1. **Check backend health**:
   ```bash
   curl http://localhost:8000/health
   ```

2. **Check API documentation**:
   Visit http://localhost:8000/docs in your browser

3. **Check frontend**:
   Visit http://localhost:3001 in your browser

4. **Trigger first RSS ingestion** (optional):
   ```bash
   curl -X POST http://localhost:8000/admin/trigger-ingest
   ```

---

## Troubleshooting

### Python Version Issues

**Problem**: Virtual environment created with wrong Python version

**Solution**:
```bash
# Remove existing venv
rm -rf .venv

# Ensure Python 3.11 is active
pyenv local 3.11.10
python --version  # Verify it shows 3.11.10

# Recreate venv
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
pip install greenlet
```

### Database Connection Issues

**Problem**: `socket.gaierror: nodename nor servname provided, or not known`

**Solution**: You're using the direct connection URL instead of Session Pooler.

1. Go to Supabase Dashboard → **Project Settings → Database → Connection String**
2. Find the **Session Pooler** section (NOT Direct Connection)
3. Copy the pooler URL (should include `pooler.supabase.com`)
4. Update `DATABASE_URL` in `.env`:
   ```bash
   DATABASE_URL=postgresql+asyncpg://postgres.<ref>:<password>@aws-X-region.pooler.supabase.com:5432/postgres
   ```
5. Restart backend

**Problem**: `ValueError: the greenlet library is required`

**Solution**:
```bash
source .venv/bin/activate
pip install greenlet
```
Then restart the backend.

### Port Already in Use

**Problem**: `ERROR: [Errno 48] Address already in use`

**Solution**:
```bash
# Find and kill process on port 8000
lsof -ti:8000 | xargs kill -9

# Or for port 3000
lsof -ti:3000 | xargs kill -9
```

### Frontend Shows "Failed to fetch"

**Checklist**:
1. Is backend running? Check http://localhost:8000/docs
2. Is `NEXT_PUBLIC_API_BASE_URL` set correctly in `frontend/.env.local`?
3. Check browser console for CORS errors
4. Verify backend logs for errors

### Supabase Project Paused

**Problem**: Database connections failing after period of inactivity

**Solution**:
1. Visit your Supabase dashboard
2. Your project may be paused (free tier pauses after inactivity)
3. Click **"Resume"** or **"Restore"** button
4. Wait 1-2 minutes for project to fully restart
5. Restart your backend

### ML Models Not Loading

**Problem**: `RuntimeError: spaCy model 'nl_core_news_lg' is not available` or enrichment fails

**Cause**: The spaCy Dutch language model was not installed or is corrupted

**Solution**:
```bash
# Activate virtual environment
source .venv/bin/activate

# Download and install the Dutch language model (568 MB)
PYTHONPATH=/Users/<your-username>/Workspace/news-aggregator .venv/bin/python -m spacy download nl_core_news_lg

# Verify installation
python -c "import spacy; nlp = spacy.load('nl_core_news_lg'); print('Success')"

# Restart backend server (if running)
# The server will auto-reload when it detects the new model
```

**Note**: This model is ~568MB and may take 5-10 minutes to download. The backend will automatically reload once installation is complete.

---

## Common Issues

### Issue: `pyenv: command not found`

**Cause**: pyenv not in PATH

**Solution**:
```bash
# Add to ~/.zshrc or ~/.bash_profile
export PYENV_ROOT="$HOME/.pyenv"
export PATH="$PYENV_ROOT/bin:$PATH"
eval "$(pyenv init -)"

# Reload shell
source ~/.zshrc  # or source ~/.bash_profile
```

### Issue: Frontend on port 3001 instead of 3000

**Cause**: Port 3000 already in use

**Solution**: This is normal. Next.js automatically uses the next available port. The application works the same on port 3001.

### Issue: No articles appearing in frontend

**Possible causes**:
1. **No RSS ingestion run yet**: Wait 15 minutes or trigger manually:
   ```bash
   # Trigger RSS feed polling
   curl -X POST http://localhost:8000/admin/trigger/poll-feeds

   # Then trigger article enrichment (NLP processing)
   curl -X POST http://localhost:8000/admin/trigger/enrich
   ```

2. **Database empty**: Check backend logs for ingestion errors

3. **Frontend not connected to backend**: Verify `NEXT_PUBLIC_API_BASE_URL` in `frontend/.env.local`

4. **Old test data visible**: The database may contain old test events. New articles from RSS feeds will appear as they are published and clustered into events.

### Issue: Large memory usage

**Expected behavior**: The backend loads several ML models:
- Sentence transformer model (~400MB)
- spaCy Dutch model (~500MB)
- TF-IDF vectorizer
- HNSW vector index

**Recommended**: 8GB RAM for comfortable operation. On machines with 4GB, close other applications.

---

## Development Workflow

### Daily Development

```bash
# Start development servers
make dev

# Backend will auto-reload on Python file changes
# Frontend will auto-reload on JS/TS/CSS changes

# View logs
make logs  # If implemented in Makefile

# Run tests
make test

# Lint code
make lint
```

### Running Tests

```bash
# Backend tests
source .venv/bin/activate
pytest backend/tests/

# Specific test file
pytest backend/tests/unit/test_feeds.py -xvs

# Frontend tests (E2E)
cd frontend
npx playwright test
```

### Database Management

```bash
# Access database via Supabase dashboard
# Or use psql:
psql "postgresql://postgres.<ref>:<password>@aws-X-region.pooler.supabase.com:5432/postgres"
```

---

## Project Structure

```
news-aggregator/
├── backend/
│   ├── app/              # Backend application code
│   │   ├── core/         # Core utilities, config, scheduler
│   │   ├── db/           # Database models, session
│   │   ├── events/       # Event detection & clustering
│   │   ├── feeds/        # RSS feed readers
│   │   ├── insights/     # LLM-powered insights
│   │   ├── nlp/          # NLP utilities (embeddings, TF-IDF)
│   │   ├── routers/      # API endpoints
│   │   └── services/     # Business logic services
│   └── tests/            # Backend tests
├── frontend/
│   ├── app/              # Next.js app directory
│   ├── components/       # React components
│   ├── lib/              # Utilities, API client
│   └── public/           # Static assets
├── data/                 # Data directory (gitignored)
│   ├── models/           # Cached ML models
│   └── vector_index.*    # HNSW index files
├── docs/                 # Documentation
├── scripts/              # Utility scripts
├── .env                  # Backend environment (gitignored)
├── .env.example          # Environment template
├── requirements.txt      # Python dependencies
├── Makefile              # Development commands
└── INSTALLATION.md       # This file
```

---

## Next Steps

After successful installation:

1. **Review the PRD**: `docs/PRD.md` for product overview
2. **Check architecture**: `docs/architecture.md` for technical details
3. **Explore the API**: Visit http://localhost:8000/docs
4. **Trigger ingestion**: POST to `/admin/trigger-ingest` to populate database
5. **View events**: Open http://localhost:3001 to see the news feed

---

## Support

For issues or questions:

1. Check this installation guide
2. Review project documentation in `docs/`
3. Check backend logs for error messages
4. Verify Supabase project status
5. Ensure all environment variables are set correctly

---

## Useful Commands

```bash
# Show all available Make commands
make help

# Clean up generated files
make clean

# Validate installation
make validate

# Update dependencies
pip install --upgrade -r requirements.txt  # Backend
cd frontend && npm update                  # Frontend

# Check Python environment
python --version
which python
pip list

# Check Node environment
node --version
npm --version
```

---

**Installation Date**: 2024-11-20

**Last Updated**: 2024-11-20

**Project**: 360° News Aggregator POC

**Python Version**: 3.11.10

**Node Version**: 18+
