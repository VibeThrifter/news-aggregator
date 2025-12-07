# Handleiding: Nieuwe Nieuwsbron Toevoegen

Dit document beschrijft de stappen en geleerde lessen voor het implementeren van nieuwe nieuwsbronnen.

## Benodigde Bestanden

| Bestand | Doel |
|---------|------|
| `backend/app/feeds/{bron}.py` | RSS feed reader class |
| `backend/app/core/config.py` | RSS URL configuratie |
| `source_profiles.yaml` | Fetch strategie & parsing config |
| `backend/app/services/ingest_service.py` | Reader registratie |
| `backend/tests/unit/test_feeds.py` | Unit tests updaten |

## Stap-voor-stap Implementatie

### 1. Feed Reader Class

Maak `backend/app/feeds/{bron}.py`:

```python
from .base import FeedReader, FeedItem, FeedReaderError

class {Bron}RssReader(FeedReader):
    @property
    def id(self) -> str:
        return "{bron}_rss"

    @property
    def source_metadata(self) -> Dict[str, Any]:
        return {
            "name": "Bron Naam",
            "spectrum": "center|center-left|center-right",
            "country": "NL",
            "language": "nl",
            "media_type": "broadsheet|tabloid|public_broadcaster|commercial_broadcaster"
        }
```

### 2. Config.py Aanpassen

Voeg toe aan `Settings` class:

```python
rss_{bron}_url: str = Field(
    default="https://www.{bron}.nl/rss",
    description="RSS feed URL for {Bron}"
)
```

### 3. Source Profile (source_profiles.yaml)

```yaml
{bron}_rss:
  feed_url: "https://www.{bron}.nl/rss"
  fetch_strategy: simple|playwright  # playwright voor JS-rendered sites
  parser: trafilatura
  user_agent: null  # of custom string indien nodig
  cookie_ttl_minutes: 0
  headers: {}
```

### 4. Registratie in IngestService

In `_register_readers()`:

```python
{bron}_profile = self._resolve_profile("{bron}_rss", default_url=self.settings.rss_{bron}_url)
{bron}_reader = {Bron}RssReader(str({bron}_profile.feed_url or self.settings.rss_{bron}_url))
self.readers[{bron}_reader.id] = {bron}_reader
self.reader_profiles[{bron}_reader.id] = {bron}_profile
```

### 5. Tests Updaten

Update `test_feeds.py`:
- Voeg mock URL toe aan `setup_method`
- Update alle assertions voor `len(self.service.readers)`
- Voeg reader ID checks toe

---

## Geleerde Lessen (Lessons Learned)

### RSS Feed Parsing

1. **Premium/Paywall Filtering**
   - Sommige bronnen markeren premium artikelen in RSS (bijv. `<premium>true</premium>`)
   - Check en filter deze VOOR het fetchen van volledige artikelen
   - Voorkomt onnodige HTTP requests en parse errors

2. **Video URLs Overslaan**
   - URLs met `/video/` hebben vaak geen artikel content
   - Filter deze in de feed reader om false positives te voorkomen
   - RTL en Telegraaf hebben beide video-only pagina's

3. **GUID Extractie**
   - Gebruik `entry.id` als primair, `entry.link` als fallback
   - Sommige feeds gebruiken volledige URLs als GUID

### HTTP Fetch Issues

4. **302 Redirects**
   - Gebruik ALTIJD `follow_redirects=True` in httpx client
   - Sommige sites redirecten naar canonical URLs

5. **Consent Dialogs (Cookies)**
   - Nederlandse nieuwssites hebben vaak cookie consent walls
   - Oplossing A: Playwright met automatisch "Akkoord" klikken
   - Oplossing B: Cookie jar met pre-accepted cookies
   - Gebruik `source_profiles.yaml` met `fetch_strategy: playwright`

6. **JavaScript-Rendered Content**
   - Sites als NU.nl laden content via JS
   - Simpele httpx fetch geeft lege/minimale content
   - Gebruik Playwright voor deze sites
   - Configureer via `fetch_strategy: playwright` in source profile

### Article Extraction

7. **Trafilatura Werkt Goed**
   - Trafilatura is betrouwbaar voor de meeste Nederlandse nieuwssites
   - Typische artikelen: 1500-3000 karakters, 200-500 woorden
   - Korte artikelen (~600 chars) kunnen legitiem zijn (nieuwsflitsen)

8. **RSS Summary als Fallback**
   - Als artikel fetch faalt, gebruik RSS `<description>` als fallback
   - Beter dan helemaal geen content
   - Genoeg voor event clustering

9. **Verwachtingen Artikellengte**
   - De Telegraaf: ~1500-2000 chars (tabloid, korter)
   - NOS: ~2000-3000 chars (uitgebreider)
   - NU.nl: ~1500-2500 chars
   - RTL: ~1500-2000 chars
   - AD: ~1500-2500 chars

### Unit Tests

10. **Test Assertions Updaten**
    - Bij toevoegen nieuwe bron: update ALLE reader count assertions
    - Zoek naar `len(self.service.readers)` in tests
    - Vergeet niet mock URLs toe te voegen

11. **Mock Settings Pattern**
    ```python
    with patch('backend.app.services.ingest_service.get_settings') as mock_settings:
        mock_settings.return_value.rss_{bron}_url = "https://mock-{bron}.nl/rss"
    ```

### Source Profile Strategieën

| Strategie | Wanneer Gebruiken |
|-----------|-------------------|
| `simple` | Statische HTML, geen JS, geen consent wall |
| `playwright` | JS-rendered, consent dialogs, complexe sites |

### Spectrum Classificatie

| Waarde | Beschrijving | Voorbeelden |
|--------|--------------|-------------|
| `center` | Neutraal, publieke omroep | NOS |
| `center-left` | Licht progressief | - |
| `center-right` | Licht conservatief/commercieel | NU.nl, RTL, AD, Telegraaf |

---

## Checklist Nieuwe Bron

- [ ] RSS feed URL gevonden en getest
- [ ] Feed reader class gemaakt
- [ ] Premium/paywall filtering geïmplementeerd (indien van toepassing)
- [ ] Video URLs filtering (indien van toepassing)
- [ ] Config.py URL toegevoegd
- [ ] Source profile toegevoegd
- [ ] IngestService registratie
- [ ] Unit tests aangepast (reader counts!)
- [ ] Handmatige test: `curl -X POST localhost:8000/admin/trigger/poll-feeds`
- [ ] Artikel content geverifieerd (>500 chars)
- [ ] Ingestion stats gecontroleerd (duplicates, failures)
