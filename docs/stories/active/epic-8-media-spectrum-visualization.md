# Epic 8: Media Spectrum Visualisatie (Manufacturing Consent)

## Overzicht

Een uitgebreide visualisatie van nieuwsbronnen gebaseerd op meerdere dimensies, geïnspireerd door Chomsky's Manufacturing Consent propagandamodel. De visualisatie helpt gebruikers begrijpen waar bronnen staan op het politieke spectrum én hoe ze zich verhouden tot institutionele machtsstructuren.

## Achtergrond

Het Manufacturing Consent model van Herman en Chomsky identificeert vijf filters die nieuws beïnvloeden:
1. **Eigendom** - Concentratie van media-eigendom
2. **Advertenties** - Afhankelijkheid van adverteerders
3. **Bronnen** - Afhankelijkheid van officiële bronnen
4. **Flak** - Gevoeligheid voor georganiseerde kritiek
5. **Ideologie** - Dominante ideologische framing

Deze story vertaalt deze filters naar meetbare dimensies voor Nederlandse nieuwsbronnen.

---

## Story 8.1: Source Metadata Uitbreiden

**Status**: 🔲 Ready
**Prioriteit**: Must Have
**Geschatte complexiteit**: Medium

### Beschrijving
Breid de `source_metadata` in elke feed-parser uit met nieuwe dimensies voor een rijkere media-analyse.

### Nieuwe Metadata Velden

```python
source_metadata = {
    # Bestaand
    "name": "De Telegraaf",
    "spectrum": "center-right",

    # Nieuw: Politieke dimensie (verfijnd)
    "political_position": 0.6,        # -1.0 (links) tot 1.0 (rechts)

    # Nieuw: Institutioneel vertrouwen
    "establishment_score": 0.7,       # -1.0 (anti-establishment) tot 1.0 (mainstream)

    # Nieuw: Chomsky filters
    "ownership": {
        "type": "corporate",          # "public" | "corporate" | "independent" | "state"
        "parent_company": "Mediahuis",
        "concentration_score": 0.8    # 0.0 (onafhankelijk) tot 1.0 (groot conglomeraat)
    },
    "funding_model": {
        "type": "mixed",              # "public" | "advertising" | "subscription" | "mixed" | "donation"
        "ad_dependency": 0.7,         # 0.0 (geen ads) tot 1.0 (volledig ad-driven)
    },
    "source_diversity": 0.5,          # 0.0 (alleen officiële bronnen) tot 1.0 (diverse bronnen)

    # Nieuw: Bereik/Invloed
    "reach": "large",                 # "small" | "medium" | "large"
    "monthly_visitors": 15000000,     # Optioneel: geschat maandelijks bereik

    # Nieuw: Stijl indicatoren
    "sensationalism": 0.6,            # 0.0 (genuanceerd) tot 1.0 (clickbait)
    "opinion_vs_fact": 0.4,           # 0.0 (puur feitelijk) tot 1.0 (opiniegedreven)
}
```

### Acceptance Criteria
- [ ] Alle 14 feed-parsers hebben uitgebreide metadata
- [ ] Nieuwe TypeScript types in `frontend/lib/types.ts`
- [ ] Supabase schema update voor bronnen-metadata (optioneel: aparte tabel)
- [ ] Unit tests voor metadata validatie

### Subtasks
- [ ] Definieer TypeScript interface voor uitgebreide metadata
- [ ] Update alle feed-parsers met nieuwe velden
- [ ] Onderzoek en documenteer scores per bron (zie referentietabel)
- [ ] Voeg database migratie toe indien nodig

### Referentietabel Nederlandse Bronnen

| Bron | Political | Establishment | Ownership | Ad Dependency | Sensationalism |
|------|-----------|---------------|-----------|---------------|----------------|
| NOS | 0.0 | 0.9 | public | 0.0 | 0.2 |
| NU.nl | 0.0 | 0.7 | corporate | 0.8 | 0.5 |
| RTL Nieuws | 0.1 | 0.8 | corporate | 0.7 | 0.4 |
| De Telegraaf | 0.5 | 0.7 | corporate | 0.7 | 0.7 |
| AD | 0.3 | 0.6 | corporate | 0.7 | 0.5 |
| de Volkskrant | -0.3 | 0.7 | corporate | 0.6 | 0.2 |
| Trouw | -0.2 | 0.7 | corporate | 0.5 | 0.2 |
| Het Parool | -0.2 | 0.6 | corporate | 0.6 | 0.3 |
| GeenStijl | 0.6 | -0.5 | corporate | 0.8 | 0.9 |
| NineForNews | 0.4 | -0.9 | independent | 0.3 | 0.7 |
| NieuwRechts | 0.8 | -0.7 | independent | 0.4 | 0.6 |
| De Andere Krant | 0.2 | -0.8 | independent | 0.2 | 0.4 |

---

## Story 8.2: Media Spectrum 2D Visualisatie

**Status**: 🔲 Ready
**Prioriteit**: Must Have
**Geschatte complexiteit**: Large
**Depends on**: Story 8.1

### Beschrijving
Bouw een interactieve 2D scatterplot visualisatie waar alle nieuwsbronnen geplot worden op twee assen:
- **X-as**: Links ↔ Rechts (politiek spectrum)
- **Y-as**: Anti-establishment ↔ Mainstream (institutioneel vertrouwen)

### Wireframe

```
                     Mainstream
                         ↑
                         |
           ○ NOS    ○ RTL
                    ○ Telegraaf
    Links ──────────┼──────────→ Rechts
                    |
         ○ Parool   |      ○ GeenStijl
                    |
           ○ Andere Krant  ○ NineForNews
                         ↓
                  Anti-establishment

Legenda:
● Groot bereik  ○ Klein bereik
🔵 Publiek  🟢 Onafhankelijk  🟠 Corporate
```

### Acceptance Criteria
- [ ] Interactieve 2D plot met alle bronnen als markers
- [ ] Marker grootte representeert bereik/invloed
- [ ] Marker kleur representeert eigendomstype
- [ ] Hover tooltip met bron details
- [ ] Click navigeert naar gefilterde artikellijst
- [ ] Responsive design (mobile-friendly)
- [ ] Dark mode ondersteuning

### Subtasks
- [ ] Kies en installeer chart library (recharts, visx, of d3)
- [ ] Bouw `MediaSpectrumChart` component
- [ ] Implementeer interactieve tooltips
- [ ] Voeg legenda toe
- [ ] Integreer in nieuwe `/spectrum` pagina
- [ ] Add E2E tests voor interactiviteit

### Technische Notities
- Overweeg `recharts` (al in veel Next.js projecten) of `visx` (meer controle)
- Zorg voor goede touch support op mobile
- Animeer posities bij filter-changes

---

## Story 8.3: Source Detail Card Component

**Status**: 🔲 Ready
**Prioriteit**: Should Have
**Geschatte complexiteit**: Medium
**Depends on**: Story 8.1

### Beschrijving
Een uitgebreide kaart die verschijnt bij hover/click op een bron in de spectrum visualisatie, met alle Chomsky-dimensies.

### Component Design

```
┌─────────────────────────────────────┐
│ 📰 De Telegraaf                     │
│ ─────────────────────────────────── │
│                                     │
│ Politiek:  ◀━━━━━━━●━━━▶           │
│            Links    Rechts          │
│                                     │
│ Institutioneel: ◀━━━━━━━━●━▶       │
│            Anti-est   Mainstream    │
│                                     │
│ ─────────────────────────────────── │
│ 📊 Chomsky Filters                  │
│                                     │
│ Eigendom        ████████░░ Corporate│
│ Ad-afhankelijk  ███████░░░ 70%     │
│ Bronnen-divers  █████░░░░░ 50%     │
│ Sensationalisme ███████░░░ 70%     │
│                                     │
│ ─────────────────────────────────── │
│ 🏢 Mediahuis  📈 15M/maand         │
│                                     │
│        [Bekijk artikelen →]         │
└─────────────────────────────────────┘
```

### Acceptance Criteria
- [ ] Radar/spider chart voor Chomsky filters
- [ ] Slider visualisaties voor politiek en establishment
- [ ] Eigenaar en bereik badges
- [ ] Link naar gefilterde artikellijst
- [ ] Responsive voor mobile (modal op kleine schermen)

### Subtasks
- [ ] Bouw `SourceDetailCard` component
- [ ] Implementeer mini radar chart voor filters
- [ ] Style met Tailwind, dark mode support
- [ ] Voeg animaties toe (fade in, scale)

---

## Story 8.4: Spectrum Indicator in EventCard

**Status**: 🔲 Ready
**Prioriteit**: Should Have
**Geschatte complexiteit**: Small
**Depends on**: Story 8.1

### Beschrijving
Upgrade de bestaande `SpectrumBar` component om de nieuwe dimensies te tonen en voeg een compacte versie toe voor de EventCard.

> **Let op**: De EventCard zelf behoudt de huidige visualisatie. Deze story focust alleen op het upgraden van de SpectrumBar component, niet op het veranderen van de EventCard layout of weergave.

### Huidige SpectrumBar
De bestaande component toont alleen links-rechts posities van bronnen.

### Uitbreiding
- Voeg optionele "establishment" indicator toe (verticale as als kleurgradiënt)
- Toon eigendomstype als icon/badge
- Compacte modus voor EventCard, uitgebreide modus voor detail pagina

### Acceptance Criteria
- [ ] SpectrumBar toont establishment score als kleur intensiteit
- [ ] Eigendomstype iconen (🏛️ publiek, 🏢 corporate, 🌱 onafhankelijk)
- [ ] `compact` prop voor kleinere weergave
- [ ] Tooltip met source details bij hover

### Subtasks
- [ ] Extend SpectrumBar props
- [ ] Voeg kleur gradient toe voor establishment
- [ ] Implementeer ownership icons
- [ ] Update EventCard integratie

---

## Story 8.5: Spectrum Filter & Vergelijking

**Status**: 🔲 Ready
**Prioriteit**: Could Have
**Geschatte complexiteit**: Medium
**Depends on**: Story 8.2, 8.3

### Beschrijving
Voeg filters toe aan de spectrum pagina om bronnen te selecteren en artikelen te vergelijken.

### Features
1. **Filter controls**: Filter op eigendomstype, bereik, politieke positie
2. **Vergelijkmodus**: Selecteer 2-4 bronnen om direct te vergelijken
3. **Coverage overlap**: Toon welke events door geselecteerde bronnen worden gedekt

### Acceptance Criteria
- [ ] Filter dropdown/checkboxes voor dimensies
- [ ] Multi-select voor bronnen vergelijking
- [ ] Side-by-side view van geselecteerde bronnen
- [ ] Export mogelijkheid (PNG/PDF)

### Subtasks
- [ ] Bouw filter UI component
- [ ] Implementeer vergelijkingsmodus
- [ ] Coverage overlap visualisatie
- [ ] Export functionaliteit

---

## Story 8.6: Documentatie & Methodologie

**Status**: 🔲 Ready
**Prioriteit**: Should Have
**Geschatte complexiteit**: Small

### Beschrijving
Documenteer de methodologie achter de scores en voeg een "Over deze visualisatie" sectie toe aan de UI.

### Content
1. **Methodologie pagina** (`/spectrum/about`):
   - Uitleg Manufacturing Consent model
   - Hoe scores zijn bepaald
   - Beperkingen en disclaimers
   - Bronnen en referenties

2. **In-app help**:
   - Tooltip uitleg per dimensie
   - "Meer info" links

### Acceptance Criteria
- [ ] Methodologie pagina met Chomsky uitleg
- [ ] Transparante scoring criteria
- [ ] Disclaimer over subjectiviteit
- [ ] Referenties naar academische bronnen

### Subtasks
- [ ] Schrijf methodologie documentatie
- [ ] Bouw `/spectrum/about` pagina
- [ ] Voeg help tooltips toe aan UI
- [ ] Review door domeinexpert (optioneel)

---

## Technische Overwegingen

### Chart Library Keuze

| Library | Pros | Cons |
|---------|------|------|
| **recharts** | Declaratief, React-native, goede docs | Beperkte customization |
| **visx** | Flexibel, D3-gebaseerd, Airbnb | Steeper learning curve |
| **d3** | Maximale controle | Veel boilerplate, niet React-native |
| **Chart.js** | Simpel, breed ondersteund | Minder React-friendly |

**Aanbeveling**: Start met `recharts` voor snelle implementatie, switch naar `visx` indien meer customization nodig.

### Data Flow

```
Backend (source_metadata)
    ↓
Supabase (sources table of inline in articles)
    ↓
Frontend API call
    ↓
MediaSpectrumChart component
    ↓
Interactive visualization
```

### Performance

- Cache source metadata (verandert zelden)
- Lazy load chart library
- Virtualize tooltips voor grote datasets

---

## Definition of Done (Epic)

- [ ] Alle 6 stories completed
- [ ] Alle bronnen hebben uitgebreide metadata
- [ ] Interactieve spectrum pagina live
- [ ] Mobile-responsive
- [ ] Dark mode support
- [ ] E2E tests passing
- [ ] Documentatie compleet
- [ ] User feedback verzameld

---

## Referenties

- Herman, E. S., & Chomsky, N. (1988). *Manufacturing Consent: The Political Economy of the Mass Media*
- [Media Bias Chart (Ad Fontes Media)](https://adfontesmedia.com/)
- [AllSides Media Bias Ratings](https://www.allsides.com/media-bias)
