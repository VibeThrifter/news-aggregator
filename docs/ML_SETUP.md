# Machine Learning Dependencies Setup

## Current Status

✅ **All ML features are fully operational** with Python 3.11 and the following stack:

- **PyTorch 2.2.2** - Neural network backend
- **sentence-transformers 2.7.0** - Multilingual text embeddings (`paraphrase-multilingual-MiniLM-L12-v2`)
- **hnswlib 0.7.0** - Fast approximate nearest neighbor search for vector similarity
- **spaCy 3.7.4** (`nl_core_news_lg`) - Named entity recognition for Dutch text
- **scikit-learn 1.5** - TF-IDF vectorization and feature engineering

## Active ML Features

1. **Semantic Embeddings** - Articles are embedded using sentence-transformers for semantic similarity
2. **Vector Search** - hnswlib provides fast ANN search for finding candidate events (within 7-day recency window)
3. **Hybrid Scoring** - Event clustering uses 50% embedding similarity + 25% TF-IDF + 25% entity matching
4. **Named Entity Recognition** - spaCy extracts persons, locations, organizations for entity-based matching
5. **LLM Classification** - Mistral API provides semantic event type classification (crime, politics, sports, etc.)

## Python Version Requirement

**Use Python 3.11** for best PyTorch compatibility on macOS.

```bash
# Check your Python version
python --version  # Should show 3.11.x

# If using Python 3.12, downgrade to 3.11
brew install python@3.11
rm -rf .venv
/usr/local/bin/python3.11 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Installation

All ML dependencies are in `requirements.txt` and installed automatically:

```bash
make setup
# OR manually:
source .venv/bin/activate
pip install -r requirements.txt
```

## Verifying ML Installation

```bash
# Test all ML components
source .venv/bin/activate
python -c "
import torch
import sentence_transformers
import hnswlib
import spacy

print(f'✅ PyTorch {torch.__version__}')
print(f'✅ sentence-transformers {sentence_transformers.__version__}')
print(f'✅ hnswlib available')
print(f'✅ spaCy {spacy.__version__}')
print('All ML dependencies ready!')
"
```

## Model Downloads

### spaCy Dutch Language Model

The Dutch NER model downloads automatically on first use:

```bash
python -m spacy download nl_core_news_lg
```

### Embedding Model

sentence-transformers downloads `paraphrase-multilingual-MiniLM-L12-v2` automatically to `data/models/` on first use.

## Performance Notes

- **Embedding generation**: ~100-500ms per article (cached in database)
- **Vector search**: ~10-50ms for k=50 candidates from 300+ articles
- **NER extraction**: ~50-200ms per article (cached in database)
- **LLM classification**: ~200-500ms per article via Mistral API

## Troubleshooting

### PyTorch installation issues on macOS

If PyTorch fails to install, try CPU-only version:

```bash
pip install torch --index-url https://download.pytorch.org/whl/cpu
pip install sentence-transformers
```

### Python 3.12 compatibility

PyTorch 2.2.2 has limited support for Python 3.12 on macOS. **Stick with Python 3.11**.

### Memory issues

The embedding model uses ~400MB RAM. For memory-constrained environments, consider:
- Using a smaller model: `paraphrase-MiniLM-L6-v2` (but lower quality)
- Processing articles in smaller batches (adjust `ENRICH_BATCH_SIZE` in config)

## Model Configuration

Models are configured in `.env`:

```bash
# Embedding model (see HuggingFace for alternatives)
EMBEDDING_MODEL_NAME=paraphrase-multilingual-MiniLM-L12-v2

# spaCy NER model
SPACY_MODEL_NAME=nl_core_news_lg

# Vector index parameters
VECTOR_INDEX_PATH=./data/vector_index.bin
VECTOR_INDEX_SPACE=cosine
VECTOR_INDEX_EF_CONSTRUCTION=200
VECTOR_INDEX_M=16
```

## Alternative Models

### Embedding Models (HuggingFace)

- **Current**: `paraphrase-multilingual-MiniLM-L12-v2` (multilingual, 118M params)
- **Faster**: `paraphrase-MiniLM-L3-v2` (English only, smaller, faster)
- **Better**: `intfloat/multilingual-e5-large` (multilingual, higher quality, slower)
- **Dutch-specific**: `GroNLP/bert-base-dutch-cased` (requires custom pooling)

### spaCy Models

- **Current**: `nl_core_news_lg` (large, best accuracy)
- **Faster**: `nl_core_news_md` (medium, good accuracy)
- **Smallest**: `nl_core_news_sm` (small, fastest but less accurate)

## Migration from Older Setup

If you previously had ML features disabled:

1. Ensure Python 3.11 is active: `python --version`
2. Reinstall dependencies: `pip install -r requirements.txt`
3. Download spaCy model: `python -m spacy download nl_core_news_lg`
4. Re-enrich existing articles: `python scripts/reenrich_with_llm.py`
5. Re-cluster: `python scripts/recluster_articles.py`
