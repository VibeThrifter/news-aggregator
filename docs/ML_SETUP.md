# Machine Learning Dependencies Setup

## Current Status

The current version of the news aggregator runs **without ML dependencies** to avoid PyTorch/sentence-transformers compatibility issues with Python 3.12 on macOS.

Development helpers (zoals `/scripts/test_rss_feeds.py`) blijven beschikbaar voor handmatige controles tijdens ML-uitrol.

## ML Features (Future Implementation)

The following dependencies have been temporarily removed from `requirements.txt` and will be added when implementing ML features:

```txt
# Commented out in requirements.txt:
# torch==2.5.1                   # PyTorch backend
# sentence-transformers==2.7.0   # Text embeddings
# hnswlib==0.7.0                 # Vector similarity search
# spacy==3.7.4                   # Named entity recognition
```

## When to Add ML Dependencies

These will be needed for:
- **Embeddings**: Article similarity and clustering (Story 4.4)
- **Vector Search**: Fast similarity queries (Story 4.5)
- **Event Detection**: Hybrid scoring with embeddings + TF-IDF (Story 4.6)
- **Named Entity Recognition**: Entity extraction for bias detection

## Installation Options (When Needed)

### Option 1: Python 3.11 (Recommended for ML)
```bash
# Install Python 3.11 for better PyTorch compatibility
brew install python@3.11
rm -rf .venv
/usr/local/bin/python3.11 -m venv .venv
source .venv/bin/activate

# Add ML dependencies to requirements.txt:
# torch==2.5.1
# sentence-transformers==2.7.0
# hnswlib==0.7.0
# spacy==3.7.4

pip install -r requirements.txt
```

### Option 2: Python 3.12 with Nightly PyTorch
```bash
# Install PyTorch nightly build for Python 3.12
pip install --pre torch sentence-transformers --index-url https://download.pytorch.org/whl/nightly/cpu
```

### Option 3: CPU-only PyTorch
```bash
# Install CPU-only version (usually has better 3.12 support)
pip install torch --index-url https://download.pytorch.org/whl/cpu
pip install sentence-transformers
```

## Current Fallback Strategy

Until ML features are implemented, the application will:
- Skip embedding generation (use placeholder vectors)
- Use basic keyword matching instead of semantic similarity
- Skip NER-based entity extraction
- Use simple TF-IDF for article similarity

## Testing ML Installation

```bash
python -c "import torch, sentence_transformers; print('ML dependencies ready')"
```