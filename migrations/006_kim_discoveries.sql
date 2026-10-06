CREATE TABLE kim_discoveries (
 url TEXT PRIMARY KEY, identity TEXT NOT NULL, data TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'queued', movie_id INTEGER, error TEXT,
 retry_at INTEGER NOT NULL DEFAULT 0, observed_at INTEGER NOT NULL
);
CREATE INDEX kim_discoveries_pending ON kim_discoveries(status,retry_at);
