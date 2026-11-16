-- Migration: official sources read by the job "Official Sources" (Stories 14.33 and 14.34)
--
-- parliament_questions_read : every set of Kamervragen (with or without answer) the job read on
--                             officielebekendmakingen.nl, with the links in its text. A set is
--                             read once; the links are matched against the articles again when
--                             new articles come in.
-- press_releases            : the news releases of the Rijksoverheid (rijksoverheid.nl, CC0), with
--                             their text, to compare with the articles word for word.
--
-- Local working database only: the website never reads them (what it shows goes to
-- event_documents, migration 024). The backend also creates the tables at startup (create_all);
-- this file is the record. Idempotent.

BEGIN;

CREATE TABLE IF NOT EXISTS parliament_questions_read (
    identifier VARCHAR(80) PRIMARY KEY,
    -- "Kamervragen" or "Antwoord op Kamervragen"
    doc_type VARCHAR(80) NOT NULL,
    title TEXT NOT NULL,
    url VARCHAR(2048) NOT NULL,
    published_at TIMESTAMPTZ,
    -- "Ergin (DENK)", "Dobbe (SP) en Van Baarle (DENK)"
    askers VARCHAR(500),
    links JSONB NOT NULL DEFAULT '[]'::jsonb,
    read_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_parliament_questions_read_published
    ON parliament_questions_read (published_at);

CREATE TABLE IF NOT EXISTS press_releases (
    url VARCHAR(2048) PRIMARY KEY,
    -- "rijksoverheid"
    publisher VARCHAR(40) NOT NULL,
    title TEXT NOT NULL,
    -- "Ministerie van Volksgezondheid, Welzijn en Sport"
    organisation VARCHAR(255),
    published_at TIMESTAMPTZ,
    text TEXT NOT NULL,
    read_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_press_releases_published ON press_releases (published_at);

COMMIT;
