-- Migration: which linked documents of a news item were read (Story 14.31)
--
-- The job "Achtergrondstukken" also reads the documents of public bodies that the articles of a
-- news item link to in their text (articles.source_metadata.links, Story 14.30), and searches the
-- analysis's terms in officielebekendmakingen.nl. It reads a news item again when its articles
-- link to other documents. NULL: searched before Story 14.31, so searched once more for the
-- Kamerstukken.
--
-- Local working database only, like migration 022: the website never reads this table. Adding a
-- nullable column without default takes no rewrite. Idempotent.

BEGIN;
SET LOCAL lock_timeout = '1s';

ALTER TABLE event_document_searches ADD COLUMN IF NOT EXISTS links JSONB;

COMMIT;
