CREATE TABLE guidance_cache(movie_id INTEGER PRIMARY KEY, data TEXT NOT NULL, expires_at INTEGER NOT NULL);
ALTER TABLE jobs ADD COLUMN background INTEGER NOT NULL DEFAULT 0;
-- Keep legacy categorical values as evidence, not as numeric Safe Stream ratings.
UPDATE movies SET data=json_set(data,'$.legacyGuidance',json_extract(data,'$.guidance'),'$.guidance',json('{}'));
