-- Trigger to notify on new site_standard_articles inserts for live feed
CREATE OR REPLACE FUNCTION notify_new_article() RETURNS TRIGGER AS $$
BEGIN
  PERFORM pg_notify('new_article', json_build_object(
    'uri', NEW.uri,
    'author_did', NEW.author_did,
    'title', NEW.title,
    'created_at', NEW.created_at
  )::text);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_new_article ON site_standard_articles;
CREATE TRIGGER trg_new_article
  AFTER INSERT ON site_standard_articles
  FOR EACH ROW
  EXECUTE FUNCTION notify_new_article();
