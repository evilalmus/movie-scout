CREATE TABLE movie_audit (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 occurred_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 event TEXT NOT NULL, movie_id INTEGER NOT NULL, title TEXT NOT NULL,
 changed_fields TEXT NOT NULL
);
CREATE TRIGGER movie_audit_insert AFTER INSERT ON movies BEGIN
 INSERT INTO movie_audit(event,movie_id,title,changed_fields)
 VALUES('movie_inserted',NEW.id,NEW.title,(SELECT json_group_array(key) FROM json_each(NEW.data)));
END;
CREATE TRIGGER movie_audit_update AFTER UPDATE ON movies
WHEN OLD.data IS NOT NEW.data OR OLD.title IS NOT NEW.title OR OLD.updated_at IS NOT NEW.updated_at
BEGIN
 INSERT INTO movie_audit(event,movie_id,title,changed_fields)
 VALUES('movie_updated',NEW.id,NEW.title,(
 SELECT json_group_array(field) FROM (
 SELECT key AS field FROM json_each(NEW.data) n WHERE NOT EXISTS(SELECT 1 FROM json_each(OLD.data) o WHERE o.key=n.key AND o.value IS n.value AND o.type=n.type)
 UNION SELECT key AS field FROM json_each(OLD.data) o WHERE NOT EXISTS(SELECT 1 FROM json_each(NEW.data) n WHERE n.key=o.key)
 UNION SELECT 'db.title' WHERE OLD.title IS NOT NEW.title
 UNION SELECT 'db.updated_at' WHERE OLD.updated_at IS NOT NEW.updated_at
 )));
END;
CREATE TRIGGER movie_audit_delete AFTER DELETE ON movies BEGIN
 INSERT INTO movie_audit(event,movie_id,title,changed_fields) VALUES('movie_deleted',OLD.id,OLD.title,'[]');
END;
