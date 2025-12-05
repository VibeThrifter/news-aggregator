# Supabase + Vercel Deployment Guide

## Step 1: Get Supabase Credentials

1. Go to https://supabase.com → Your Project → Settings → Database
2. Copy these values:
   - **Connection String** (under "Connection string" → "URI"):
     `postgresql://postgres:[YOUR-PASSWORD]@db.xfqvwplrgwubbgbumzwk.supabase.co:5432/postgres`
   - **Direct Connection** (for backend):
     `postgresql://postgres:[YOUR-PASSWORD]@db.xfqvwplrgwubbgbumzwk.supabase.co:5432/postgres`
   
3. Go to Settings → API
   - Copy **Project URL**: `https://[project-ref].supabase.co`
   - Copy **anon public key**: `eyJ...` (long JWT token)

## Step 2: Install PostgreSQL Support

```bash
.venv/bin/pip install asyncpg==0.29.0
```

## Step 3: Update Backend .env

Add to your `.env` file:
```bash
# Replace with your actual Supabase connection string
DATABASE_URL=postgresql+asyncpg://postgres:[YOUR-PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres

# Optional: keep SQLite for local development
# DATABASE_URL=sqlite+aiosqlite:///./data/app.db
```

## Step 4: Create Tables in Supabase

Run migrations to create tables:
```bash
# Install alembic if not already installed
.venv/bin/pip install alembic

# Generate initial migration
alembic revision --autogenerate -m "Initial schema"

# Apply to Supabase
alembic upgrade head
```

## Step 5: Migrate Existing Data (Optional)

If you want to keep your current articles/events:
```bash
# Export from SQLite
python scripts/export_sqlite_data.py

# Import to Supabase
python scripts/import_to_supabase.py
```

## Step 6: Configure Frontend for Supabase

Option A: Use Supabase JS Client (Easiest)
```bash
cd frontend
npm install @supabase/supabase-js
```

Create `frontend/lib/supabase.ts`:
```typescript
import { createClient } from '@supabase/supabase-js'

export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)
```

Option B: Keep using REST API via backend
- No changes needed
- Backend API continues to work as proxy

## Step 7: Deploy to Vercel

```bash
cd frontend

# Login to Vercel
vercel login

# Deploy
vercel

# Set environment variables in Vercel dashboard:
# - NEXT_PUBLIC_SUPABASE_URL
# - NEXT_PUBLIC_SUPABASE_ANON_KEY
```

## Step 8: Run Backend Locally

Your backend continues running on your machine:
```bash
make backend-dev
# or
PYTHONPATH=. python3.11 -m uvicorn backend.app.main:app --host 0.0.0.0 --port 8000 --reload
```

## Architecture

```
Local Backend (Your Machine)
    ↓ writes to
Supabase PostgreSQL
    ↑ reads from
Vercel Frontend (Public)
```

Backend runs scheduled jobs locally (RSS polling, ML enrichment).
Frontend deployed on Vercel reads data from Supabase directly.

## Benefits

✅ No memory limits for ML processing
✅ Free Vercel hosting
✅ Free Supabase database (500MB)
✅ Frontend accessible 24/7
✅ Backend only needs to run during processing
