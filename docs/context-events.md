algoritme dat je lokaal kunt draaien voor **event detection in een nieuwsstream** (zoals uit NOS en NU.nl RSS). Dit wordt een soort *design document* waarin alles stap voor stap staat: de datastructuren, de pipeline, de wiskunde, en de keuzes die dit schaalbaar en accuraat maken.

> ℹ️ Handige hulpscripts vind je in `/scripts`, waaronder `test_rss_feeds.py` om RSS-bronnen snel te testen en `refresh_cookies.py` om consent-cookies automatisch te vernieuwen.

---

# 📘 Volledige Methode voor Event Detection in Nieuwsstreams

---

## 🔹 Doel

Bouw een systeem dat **automatisch nieuwsartikelen groepeert in events**:

* Een **event = verzameling artikelen die over dezelfde gebeurtenis gaan**.
* Elke nieuw artikel wordt óf toegewezen aan een bestaand event, óf start een nieuw event.
* Het systeem moet **realtime/near-realtime** werken, accuraat zijn en schaalbaar blijven na tienduizenden artikelen.

---

## 🔹 Belangrijkste uitdagingen

1. Hoe herken je dat twee artikelen over hetzelfde event gaan (semantisch)?
2. Hoe voorkom je dat alles in één cluster belandt (te los) of alles een nieuw event wordt (te streng)?
3. Hoe hou je het efficiënt bij veel events/artikelen?

Oplossing: **hybride event detection** → gebruik embeddings + TF–IDF + entiteiten, met cosine similarity + vector indexering.

---

## 🔹 Datarepresentatie

### Artikel

Elk artikel krijgt de volgende velden:

* `id`
* `source` (NOS, NU.nl, …)
* `title`
* `url`
* `published` (timestamp)
* `text` (volledige tekst)
* `embedding` (dense vector, bv. 384D uit MiniLM of RobBERT/NewsBERTje)
* `tfidf_vector` (sparse vector)
* `entities` (lijst personen/locaties/organisaties via spaCy)

### Event

Een event wordt opgeslagen als:

* `id`
* `title` (titel eerste artikel of samenvatting)
* `articles` (lijst van article-IDs)
* `centroid_embedding` (gemiddelde van alle embeddings in dit event)
* `centroid_tfidf` (gemiddelde TF–IDF vector van clusterleden)
* `entities` (unieke set entiteiten in het cluster)
* `first_seen`, `last_updated`

---

## 🔹 Algoritme stap voor stap

### 1. **Ingestie (RSS lezen)**

* Met `feedparser` haal je periodiek (bv. elke 5 min) nieuwe items op uit RSS-feeds.
* Check of de URL al in database staat → zo niet, verwerk als nieuw artikel.
* Download tekst (met `trafilatura` of `newspaper3k`).

---

### 2. **Preprocessing**

* **Tekst normaliseren**: lowercase, stopwoorden verwijderen (voor TF–IDF).
* **Embeddings**: bereken met een `sentence-transformers` model, bv.:

  * Snel: `paraphrase-multilingual-MiniLM-L12-v2` (384D, CPU-snel).
  * Accuraat: `RobBERT` of `NewsBERTje` (768D, NL-specifiek).
* **TF–IDF vector**: via `scikit-learn` `TfidfVectorizer`.
* **Named Entity Recognition**: met `spaCy` NL model → lijst met personen, plaatsen, organisaties.

---

### 3. **Event Candidate Search**

* **Index**: alle event-centroids worden bewaard in een **ANN (approximate nearest neighbor) index**, bv. `hnswlib` of `pgvector`.
* **Query**: voor het nieuwe artikelembedding → vraag de **top-k meest vergelijkbare events** op (cosine similarity).

  * Dit kost milliseconden, ook bij tienduizenden events.
* **Tijdvenster**: beperk query tot events die in de **laatste X dagen** actief zijn (bv. 7).

---

### 4. **Scoring**

Voor elk kandidaat-event bereken je een gecombineerde score:

* **Embedding cosine similarity**

  * Hoofdcriterium voor semantische overeenkomst.

* **TF–IDF cosine similarity**

  * Voorkomt verkeerde merges bij events met zelfde algemene context, maar verschillende details (bijv. “Ajax wint” vs. “PSV wint”).

* **Entity overlap score**

  * Bijvoorbeeld: aantal gedeelde entiteiten / totaal aantal entiteiten.
  * Garandeert dat twee artikels over “Rutte in Brussel” niet in hetzelfde cluster komen als “Sanchez in Brussel”.

* **Tijdsafstand**

  * Als publicatietijd van artikel veel verder ligt dan `last_updated` van cluster, verlaag score.

**Final score voorbeeld:**

```
final_score = 0.6 * cosine(embedding) 
            + 0.3 * cosine(tfidf) 
            + 0.1 * entity_overlap
```

---

### 5. **Beslissing**

* Kies de kandidaat met hoogste score.
* Als `final_score ≥ threshold` (bv. 0.82):

  * Artikel hoort bij dit event → toevoegen.
* Anders:

  * Start een **nieuw event** met dit artikel als eerste lid.

---

### 6. **Event Update**

Als artikel aan bestaand event wordt toegevoegd:

* Voeg artikel toe aan lijst.
* Update `centroid_embedding = mean(all article embeddings)`
* Update `centroid_tfidf = mean(tfidf vectors)`
* Voeg entiteiten toe aan `entities`.
* Update `last_updated` timestamp.

Als nieuw event:

* Maak event-ID aan.
* Zet embedding + tfidf van dit artikel als initial centroid.
* Insert in database en in vector index.

---

## 🔹 Database Schema (voorbeeld in SQLite/Postgres)

```sql
CREATE TABLE articles (
  id INTEGER PRIMARY KEY,
  source TEXT,
  url TEXT UNIQUE,
  title TEXT,
  published TIMESTAMP,
  text TEXT,
  embedding BLOB
);

CREATE TABLE events (
  id INTEGER PRIMARY KEY,
  title TEXT,
  centroid_embedding BLOB,
  centroid_tfidf BLOB,
  entities TEXT,
  first_seen TIMESTAMP,
  last_updated TIMESTAMP
);

CREATE TABLE event_articles (
  event_id INTEGER,
  article_id INTEGER,
  FOREIGN KEY (event_id) REFERENCES events(id),
  FOREIGN KEY (article_id) REFERENCES articles(id)
);
```

---

## 🔹 Efficiency & Schaalbaarheid

* **ANN index (hnswlib)** → O(log n) search i.p.v. O(n).
* **Centroid per event** → je vergelijkt nooit met alle artikelen.
* **Tijdvenster filtering** → oude events automatisch uitgesloten.
* **Batch-updates** → embeddings in batches verwerken versnelt inference.

👉 Dit maakt het systeem schaalbaar tot **100k–1M artikelen** op één server.

---

## 🔹 Parameters om te tunen

* **Threshold (0.8–0.85)** → bepaalt strengheid van clustering.
* **Gewichten (0.6/0.3/0.1)** → balans embeddings, tfidf, entities.
* **Tijdvenster (5–14 dagen)** → hoe lang een event open blijft voor nieuwe artikelen.
* **k (top-k candidates, bv. 5)** → hoe veel mogelijke events je checkt per artikel.

---

# ✅ Conclusie

De methode is:

1. **Nieuw artikel → embedding, tfidf, entities.**
2. **ANN query → top-k candidate events.**
3. **Hybride scoring (embedding + tfidf + entities + tijd).**
4. **Als score ≥ threshold → bij bestaand event, anders nieuw event.**
5. **Event-centroid updaten + index aanpassen.**

Dit combineert **snelheid (hnswlib/pgvector)** met **nauwkeurigheid (hybride features)** en is bewezen schaalbaar én geschikt voor Nederlands (met RobBERT/NewsBERTje).

---

Wil je dat ik dit nu omzet in een **technisch whitepaper-stijl document** (met schema’s en voorbeeldcodeblokken), zodat je het letterlijk als blueprint in je repo kunt gebruiken?
