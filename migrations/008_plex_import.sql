CREATE TABLE plex_scan (
 source TEXT PRIMARY KEY, state TEXT NOT NULL DEFAULT '{}',
 next_scan INTEGER NOT NULL DEFAULT 0, lease_until INTEGER NOT NULL DEFAULT 0,
 last_complete TEXT, error TEXT
);
CREATE TABLE plex_items (
 source TEXT NOT NULL, rating_key TEXT NOT NULL, library_id TEXT NOT NULL,
 data TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'queued', movie_id INTEGER,
 retry_at INTEGER NOT NULL DEFAULT 0, error TEXT, seen_at INTEGER NOT NULL,
 PRIMARY KEY(source,rating_key)
);
CREATE INDEX plex_items_pending ON plex_items(source,status,retry_at);
