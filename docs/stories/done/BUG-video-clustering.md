# BUG: Video Pages Causing False Event Clustering

**Story ID:** BUG-002
**Type:** Bug Fix
**Status:** Done
**Priority:** High

## Problem Summary

Totaal ongerelateerde artikelen werden samen geclusterd in hetzelfde event. Event 946 bevatte bijvoorbeeld:
- Gijzelnemer Vught
- Marco Borsato vrijspraak
- Sinterklaas pakjesavond
- Yvonne Coldeweijer Juice-programma
- Het Perfecte Plaatje finale

De similarity scores waren abnormaal hoog (0.92-0.95) voor artikelen die niets met elkaar te maken hebben.

## Root Cause Analysis

### Het probleem

RTL, Telegraaf en NU.nl RSS feeds bevatten ook `/video/` URLs. Deze video pagina's hebben **geen echte artikel content**, alleen:

1. Een video player met "videoland account nodig" bericht
2. Een **gedeelde sidebar/carrousel** met alle andere recente videos

### Wat er gebeurde

```
Video pagina A (Gijzelnemer):     "afspelen video videoland... Marlijn melanoom... Kirsten Westrik..."
Video pagina B (Marco Borsato):   "afspelen video videoland... Marlijn melanoom... Kirsten Westrik..."
Video pagina C (Sinterklaas):     "afspelen video videoland... Marlijn melanoom... Kirsten Westrik..."
```

Alle video pagina's hadden **vrijwel identieke scraped content** door de gedeelde carrousel. Dit resulteerde in:
- Bijna identieke embeddings
- Similarity scores > 0.92
- Foutieve clustering in hetzelfde event

### Impact data

```
Getroffen video artikelen: 45
Getroffen events: 26 (volledig bestaand uit video artikelen)
Bronnen: RTL, Telegraaf, NU.nl
```

## Acceptance Criteria (AC)

- [x] Given een RSS feed met video URLs when de feed wordt geparsed, then worden /video/ URLs overgeslagen.
- [x] Given bestaande video artikelen in de database when de cleanup draait, then worden deze verwijderd.
- [x] Given events met alleen video artikelen when de cleanup draait, then worden deze events verwijderd.
- [x] Given de vector index when de cleanup is voltooid, then bevat deze geen verwijderde events meer.

## Solution Implemented

### 1. Filter video URLs in feed readers

**RTL** (`backend/app/feeds/rtl.py`):
```python
# Skip video pages - they have no article content, only a video player
# and a shared sidebar that causes false clustering matches
url = getattr(entry, "link", "")
if "/video/" in url or "/boulevard/video/" in url:
    skipped_videos += 1
    continue
```

**Telegraaf** (`backend/app/feeds/telegraaf.py`):
```python
# Skip video pages - they have minimal article content
url = getattr(entry, "link", "")
if "/video/" in url:
    video_count += 1
    continue
```

**NU.nl** (`backend/app/feeds/nunl.py`):
```python
# Skip video pages - they have minimal article content
url = getattr(entry, "link", "")
if "/video/" in url:
    video_count += 1
    continue
```

### 2. Database cleanup

Uitgevoerde cleanup:
1. Verwijder `event_articles` links voor video artikelen
2. Verwijder events die alleen video artikelen bevatten
3. Verwijder `llm_insights` voor verwijderde events
4. Verwijder video artikelen uit `articles` tabel
5. Herbouw vector index

### 3. Resultaat

```
Verwijderde video artikelen: 45
Verwijderde events: 26
Vector index herbouwd: 684 events
```

## Technical Notes

- Video pagina's zijn te herkennen aan `/video/` in de URL
- RTL Boulevard heeft ook `/boulevard/video/` URLs
- De sidebar content bevatte titels van ~10-15 andere videos, waardoor alle pagina's vrijwel dezelfde TF-IDF vectoren en embeddings kregen
- Normale artikelpagina's hebben unieke content en werken correct

## Files Changed

| File | Change |
|------|--------|
| `backend/app/feeds/rtl.py` | Filter `/video/` URLs |
| `backend/app/feeds/telegraaf.py` | Filter `/video/` URLs |
| `backend/app/feeds/nunl.py` | Filter `/video/` URLs |

## Story Wrap Up

- **Agent Model Used:** Claude Opus 4.5
- **Date/Time Completed:** 2025-12-05 21:44
- **Commit Hash:** _pending_
- **Change Log:**
  - Added video URL filtering to RTL, Telegraaf, and NU.nl feed readers
  - Cleaned up 45 video articles and 26 events from database
  - Rebuilt vector index with valid events only
