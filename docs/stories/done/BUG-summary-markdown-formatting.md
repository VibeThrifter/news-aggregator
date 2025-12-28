# BUG: LLM Summaries Not Using Markdown Formatting

> Event summaries are generated as plain text despite explicit markdown instructions in the prompt.

## Problem Description

The `factual_prompt.txt` includes clear instructions for markdown formatting:
- Use `\n\n` for paragraph breaks
- Use `**bold**` for section headers (tussenkopjes)
- Example: `"Eerste alinea tekst.\n\n**Tussenkopje**\n\nTweede alinea."`

However, actual LLM output contains **no markdown**:
- No `**bold**` markers
- No paragraph breaks (`\n\n`)
- Just continuous plain text

## Evidence

Query against latest summary (event_id: 2784):
```
Has ** (bold):  False
Has paragraph breaks:  False
Has any newlines:  False
```

Example output:
> "Twee Nederlandse wintersporters hebben zware verwondingen opgelopen bij afzonderlijke incidenten in het Oostenrijkse Tirol. Bronnen melden dat het gaat om een 6-jarig meisje en een 19-jarige jonge man..."

Expected format:
> "Wintersportongelukken in Tirol.\n\n**Twee slachtoffers**\n\nTwee Nederlandse wintersporters hebben zware verwondingen opgelopen..."

## Root Cause Analysis

**Confirmed:** Database prompt has markdown instructions (OPMAAK section present with `**bold**` and `\n\n` examples).

The LLM is **ignoring the formatting instructions**. Common reasons:
1. Instructions buried too deep in prompt (LLM attention fade)
2. No few-shot examples showing exact expected output format
3. Model (Mistral/DeepSeek/Gemini) struggles with inline JSON escaping (`\\n\\n`)

## Recommended Fix

Move markdown instructions into the JSON schema comment and add a concrete example:
```json
"summary": "MUST contain markdown. Example:\n\nKorte titel hier.\\n\\n**Eerste sectie**\\n\\nInhoud...\\n\\n**Tweede sectie**\\n\\nMeer inhoud..."
```

Or add a few-shot example showing the exact expected JSON output with proper escaping.

## Investigation Steps

- [x] Check if database prompt matches local file - **CONFIRMED: matches**
- [x] Add markdown instructions to prompt section 9 (OPMAAK)
- [x] Sync local file and database prompt
- [x] Test regeneration with DeepSeek - **SUCCESS: markdown now present**
- [x] Verify fix works with Mistral provider - **SUCCESS: markdown present**
- [x] Fix frontend to fetch latest insight (was fetching old one)
- [x] Verify frontend rendering - **SUCCESS**
- [ ] Verify fix works with Gemini provider (optional)

## Fix Applied (2025-12-27)

**Revision 2**: Restored original prompt structure, added minimal markdown instructions:

Changes to `factual_prompt.txt` section 9 (OPMAAK):
- Specified `\n\n` (dubbele newline) for paragraph breaks
- Clarified `**tussenkopjes**` syntax with example
- Added "VERPLICHT" requirement
- Updated JSON schema description to mention markdown requirements

Changes synced to both:
- Local file: `backend/app/llm/templates/factual_prompt.txt`
- Database: `llm_config.prompt_factual`

**Note**: Initial fix with full few-shot example broke title generation. Reverted to minimal changes.

### Test Result (DeepSeek)
```
Provider: deepseek
Has ** (bold): True
Has paragraph breaks: True

Summary: "Twee Nederlanders zwaargewond bij skiongelukken in Tirol.

Twee Nederlandse wintersporters hebben zware verwondingen opgelopen...

**Details over het ongeluk**

Het meisje raakte gewond in het skigebied..."
```

### Test Result (Mistral - Revision 2)
```
Provider: mistral
Has ** (bold): True
Has paragraph breaks: True
Title length: 62 chars (target: max 60)

Summary: "Amerikanen zoeken Europees paspoort uit angst voor democratie.

Duizenden Amerikanen overwegen een Europees paspoort...

**Motivatie voor emigratie**

Volgens RTL Nieuws zijn er verschillende factoren..."
```

### Frontend Fixes
1. Fixed `frontend/lib/api.ts` to fetch latest insight (order by id desc) instead of arbitrary one when multiple insights exist for an event.
2. Fixed `frontend/app/event/[id]/EventDetailScreen.tsx` to strip first sentence (title) from summary body to avoid duplication - title now only appears in `<h1>`, not repeated in summary text.

## Acceptance Criteria

- [x] Summaries contain `**bold**` section headers - **VERIFIED: DeepSeek + Mistral**
- [x] Summaries have paragraph breaks (`\n\n`) - **VERIFIED: DeepSeek + Mistral**
- [x] ReactMarkdown in frontend renders properly formatted text - **VERIFIED**
- [ ] Verify fix works with Gemini provider (optional - lower priority)

## Technical Notes

### Files involved
- `backend/app/llm/templates/factual_prompt.txt` - Prompt template (lines 64-72)
- `backend/app/services/insight_service.py` - Insight generation logic
- `backend/app/llm/client.py` - LLM client wrapper
- `frontend/app/event/[id]/EventDetailScreen.tsx` - Frontend rendering (lines 201-210)

### Database config
The prompt is stored in Supabase `llm_config` table under key `prompt_factual`. To update:
```python
requests.patch(
    url + '?key=eq.prompt_factual',
    headers=headers,
    json={'value': prompt_content}
)
```

### IMPORTANT: Prompt Sync Requirement
Local files and database prompts MUST stay in sync:
- Edit local file: `backend/app/llm/templates/factual_prompt.txt`
- Then upload to database using script in CLAUDE.md (section "LLM Prompts Updaten")
- **Never edit one without updating the other**

### Frontend already ready
The frontend uses ReactMarkdown with proper prose styling and should render markdown correctly once the LLM outputs it.

## Status

**VERIFIED WORKING** - Frontend rendering confirmed.

The prompt fix is complete and both DeepSeek and Mistral now produce markdown-formatted summaries that render correctly in the frontend.

### Final Result
Summaries now follow the intended journalistic paraphrasing style:
- Geaggregeerde bronvermelding: "Op sociale media noemen bezoekers de ingreep 'een absolute verschrikking'"
- Geparafraseerde anonieme reacties: "Woorden als 'lelijk', 'nep' en 'zorgwekkend' vallen veelvuldig"
- Benoemde bronnen met citaten: Samya Hafsaoui: "Als actrice met een hoofddoek..."
- **Bold tussenkopjes** voor secties
- Bronattributie: "meldt *De Telegraaf*"

### Additional Fixes (2025-12-27 evening)

#### Anti-Hallucination Instructions
Added strong anti-hallucination section at top of prompt:
```
**KRITISCH: GEEN HALLUCINATIES - LEES DIT ZORGVULDIG**
- Gebruik UITSLUITEND informatie uit de hieronder gegeven artikelen
- VERZIN ABSOLUUT GEEN bronnen, reacties, sociale media, of feiten die niet letterlijk in de artikelen staan
- Als er maar 1 artikel is: beschrijf ALLEEN wat dat ene artikel meldt, verzin geen andere bronnen
- VERBODEN woorden als ze niet in artikelen staan: "op sociale media", "alternatieve media", "overheidsbronnen"
- CHECK JEZELF: staat dit echt in een artikel? Zo nee, SCHRAP het
```

Also added reminder after article capsules:
```
HERINNERING: Gebruik ALLEEN bovenstaande artikelen. VERZIN NIETS. Als er 1 artikel is, heb je 1 bron.
```

#### Multiple Paragraphs Per Section
Changed section requirements to enforce more content per section:
```
9. **OPMAAK** - Maak de tekst visueel leesbaar met MARKDOWN:
   - Korte alinea's van 2-4 zinnen, gescheiden door \n\n (dubbele newline)
   - Gebruik MAXIMAAL 2-3 **tussenkopjes** (niet meer!)
   - Onder elk kopje: MINIMAAL 2 alinea's, bij voorkeur 3-4
   - FOUT: 5 kopjes met elk 1 alinea (te gefragmenteerd)
   - GOED: 2 kopjes met elk 3-4 alinea's (vloeiend verhaal)
```

#### LLM Provider Configuration
- **DeepSeek timeout issue**: Fixed with dedicated `deepseek_timeout_seconds` setting (default 300s = 5 min)
- **Improved timeout handling**: Uses `httpx.Timeout` with separate connect/read timeouts for robustness
- **Gemini rate limit**: Gemini has 1500 free requests/day, can hit limit with heavy usage

**DeepSeek Timeout Fix (2025-12-27)**:
The issue was that httpx was using a single timeout value for all operations. For long-running LLM requests, the **read timeout** needs to be much longer than connect timeout.

Changes made:
1. Added `deepseek_timeout_seconds` setting in `config.py` (default: 300s)
2. Updated `DeepSeekClient` to use `httpx.Timeout` with:
   - `connect=30.0` - Connection timeout (short)
   - `read=300.0` - Read timeout (long for complex prompts)
   - `write=30.0` - Write timeout
   - `pool=30.0` - Pool timeout

**Recommended provider configuration**:
- `provider_factual`: `deepseek` (works with new timeout)
- `provider_critical`: `deepseek` (should now work with 300s read timeout)

#### Test Results

**Event 2784 (DeepSeek - both phases)**:
```
Provider: deepseek
Status: SUCCESS
Factual: 2348 prompt tokens, 739 completion tokens
Critical: 3233 prompt tokens, 1241 completion tokens
```

**Event 2735 (DeepSeek - both phases)**:
```
Provider: deepseek
Status: SUCCESS
Factual: 3995 prompt tokens, 1454 completion tokens
Critical: 5189 prompt tokens, 3177 completion tokens
```

**Mistral Test (earlier)**:
```
Provider: mistral
Has ** (bold): True
Has paragraph breaks: True
Count of ** sections: 3

Summary quality:
- 3 sections with multiple paragraphs each
- Sources properly compared: "Waar RTL Nieuws specifiek vermeldt... benadrukt NU.nl..."
- No hallucinations - only real sources (ANWB, RTL Nieuws, NU.nl, NOS, Rijnmond)
```

## Priority

**High** - Affects readability of all event summaries on the website.

---

## Related

- `factual_prompt.txt` - Contains markdown instructions (lines 64-72)
- `EventDetailScreen.tsx` - Uses ReactMarkdown for rendering
- `backend/app/core/config.py` - LLM timeout settings (line 193-196)
