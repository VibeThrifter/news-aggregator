-- Migration: what a document says about the news (Stories 14.33 and 14.34)
--
-- event_documents.details holds what the Tijdlijn shows under a document, written by the backend:
--   - Kamervragen that link to an article of the news (Story 14.33):
--       {"cites": [{"article_id": 123, "outlet": "NU.nl"}], "askers": "Ergin (DENK)"}
--   - a motion or amendment the Tweede Kamer voted on (Story 14.33):
--       {"vote": {"result": "Aangenomen", "for": [["D66", 26], ...], "against": [["PVV", 19], ...],
--                 "seats_for": 88, "seats_against": 62, "kind": "Met handopsteken"},
--        "vote_checked_at": "2026-11-16T10:00:00+00:00"}
--   - a press release of the Rijksoverheid whose text or quotes stand word for word in articles of
--     the news (Story 14.34):
--       {"quoted_by": [{"article_id": 123, "outlet": "NOS", "quotes": ["…"], "share": 0.47}]}
--
-- Run on both databases (local working database and Supabase): the column is published. Adding a
-- nullable column without default takes no rewrite; lock_timeout keeps a waiting ALTER from
-- blocking the readers (retry when it times out). Idempotent.

BEGIN;
SET LOCAL lock_timeout = '1s';

ALTER TABLE event_documents ADD COLUMN IF NOT EXISTS details JSONB;

COMMIT;
