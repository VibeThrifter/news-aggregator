# Epic 7: Clustering Quality Improvements

> Improve the accuracy of article-to-event clustering by addressing the root cause: embedding model quality.

## Background

The current clustering pipeline uses:
1. Embedding similarity (60% weight)
2. TF-IDF similarity (30% weight)
3. Entity overlap (10% weight)
4. LLM final decision
5. Sport keyword filtering (hard constraint)
6. Crime location/time constraints

**Known issues:**
- Different sports get clustered together (e.g., "WK voetbal" with "World Cup schaatsen")
- Generic multilingual embeddings don't capture Dutch-specific nuances
- Keyword-based sport detection is brittle and requires constant maintenance

**Root cause analysis:**
The sport clustering issue stems from the **embedding model** (`paraphrase-multilingual-MiniLM-L12-v2`), which is optimized for English. Terms like "World Cup" and "WK" have high semantic similarity regardless of sport context. The current keyword-based filtering is a band-aid, not a fix.

## Implementation Philosophy

Address root cause first, measure, then add complexity only if needed:
1. Fix the embedding model (root cause)
2. Improve LLM prompts (quick wins, low effort)
3. Measure results
4. Only add metadata extraction/review queues if accuracy is still insufficient

---

## Story 7.1: Dutch-Optimized Embeddings

**Priority:** Critical (Phase 1 - START HERE)
**Effort:** Medium

### Description
Upgrade to Dutch-optimized embedding model. This addresses the root cause of clustering issues by providing embeddings that understand Dutch language nuances and domain-specific terminology.

### Acceptance Criteria
- [ ] Research available Dutch embedding models (E5-NL, RobBERT, etc.)
- [ ] Benchmark top candidates on sample clustering tasks
- [ ] Select optimal model balancing accuracy vs. memory/speed
- [ ] Update `backend/app/nlp/embeddings.py` to use new model
- [ ] Handle model-specific requirements (E5 prefix, dimension changes)
- [ ] Create migration script to re-embed existing articles
- [ ] Rebuild vector index with new dimensions
- [ ] Measure clustering accuracy before/after

### Technical Notes
- `clips/e5-base-trm-nl` is a strong candidate (768D, Dutch-optimized)
- E5 models require "query:" and "passage:" prefixes
- Model requires ~400MB memory (within local deployment constraints)
- Research: https://huggingface.co/collections/clips/e5-nl-68be9d3760240ce5c7d9f831
- Current model: `paraphrase-multilingual-MiniLM-L12-v2` (384D)

### Success Metrics
- Reduce false positive rate for sport clustering by >80%
- Maintain or improve overall clustering rate (currently 32%)

---

## Story 7.2: LLM Decision Improvements

**Priority:** High (Phase 2)
**Effort:** Small

### Description
Quick wins to improve LLM clustering decisions while 7.1 is being implemented.

### Acceptance Criteria
- [x] Add sample article titles from candidate events to prompt
- [x] Add concrete examples of correct decisions to prompt
- [x] Add explicit warnings about common mistakes (WK in different sports)
- [ ] Add chain-of-thought: ask LLM to explain reasoning before deciding
- [ ] Log LLM reasoning for debugging
- [ ] Add "REJECTED" section showing filtered candidates

### Technical Notes
- Some improvements already implemented
- Balance prompt length vs. token costs
- Chain-of-thought adds ~50 tokens but may improve accuracy

---

## Story 7.3: Remove Keyword-Based Sport Detection

**Priority:** Medium (Phase 4 - after measuring)
**Effort:** Small

### Description
Once Dutch embeddings are in place, remove or simplify the brittle keyword-based sport detection in `event_service.py`. The embedding model should handle this implicitly.

### Acceptance Criteria
- [ ] Verify Dutch embeddings correctly separate different sports
- [ ] Remove or deprecate `SPORT_CATEGORIES` dict (lines 103-126)
- [ ] Simplify `_detect_sport_category()` and `_are_different_sports()`
- [ ] Keep as optional fallback with config flag if needed
- [ ] Update tests

### Technical Notes
- Current implementation has 13 sport categories with ~150 keywords
- This is unmaintainable long-term (new sports, new tournaments)
- Dutch embeddings should handle "WK voetbal" vs "WK schaatsen" naturally

---

## Story 7.4: Clustering Metrics & Evaluation

**Priority:** High (Phase 3 - validate improvements)
**Effort:** Small

### Description
Add metrics to measure clustering quality and validate improvements from 7.1.

### Acceptance Criteria
- [ ] Track metrics:
  - Clustering rate (% articles assigned to existing events)
  - Average event size
  - LLM override rate (when LLM disagrees with score)
  - Sport cross-clustering rate (manual spot check)
- [ ] Expose metrics via `/admin/metrics/clustering` endpoint
- [ ] Create baseline measurement before 7.1
- [ ] Compare after 7.1 deployment

### Technical Notes
- Essential for validating embedding model change
- Keep simple - no need for elaborate dashboards yet

---

## Story 7.5: Structured Metadata Extraction (Optional)

**Priority:** Low (Phase 5 - only if needed)
**Effort:** Medium

### Description
**Only implement if 7.1 doesn't sufficiently solve the problem.** Extract structured metadata for hard filtering.

### Acceptance Criteria
- [ ] Evaluate if still needed after 7.1 deployment
- [ ] If needed: extract `sport_type` via LLM during enrichment
- [ ] Store in article record
- [ ] Use for hard filtering in clustering

### Technical Notes
- This adds complexity and LLM costs
- Only pursue if Dutch embeddings alone aren't sufficient
- Already have `event_type` classification - could extend pattern

---

## Story 7.6: Confidence Scoring & Review Queue (Future)

**Priority:** Low (Phase 6 - future polish)
**Effort:** Medium

### Description
Flag low-confidence clustering decisions for human review. Consider for future iteration.

### Acceptance Criteria
- [ ] Define confidence thresholds
- [ ] Add `needs_review` flag to models
- [ ] Create admin review interface
- [ ] Allow manual merge/split of events

### Technical Notes
- Nice-to-have for quality control
- Not essential for MVP accuracy improvements

---

## Implementation Order

**Priority: Root cause first, measure, add complexity only if needed**

| Phase | Story | Rationale |
|-------|-------|-----------|
| 1 | **7.1** Dutch Embeddings | Root cause fix - model doesn't understand Dutch |
| 2 | **7.2** LLM Improvements | Quick wins, low effort, compounds with 7.1 |
| 3 | **7.4** Metrics & Evaluation | Measure improvement, validate approach |
| 4 | **7.3** Remove Keyword Detection | Cleanup brittle code if embeddings work |
| 5 | **7.5** Structured Metadata | Only if 7.1+7.2 insufficient |
| 6 | **7.6** Review Queue | Future polish, not MVP |

**Decision gate after Phase 3:** If clustering accuracy meets targets, skip 7.5 and 7.6.

---

## Related

- BUG-video-clustering.md - Previous clustering bug fix (content quality issue)
- docs/context-events.md - Event detection algorithm spec
