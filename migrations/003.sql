ALTER TABLE sessions ADD COLUMN scope TEXT NOT NULL DEFAULT 'local';
CREATE TABLE provider_daily (
  provider TEXT NOT NULL, day TEXT NOT NULL, requests INTEGER NOT NULL, tokens INTEGER NOT NULL,
  PRIMARY KEY(provider,day)
);
PRAGMA user_version=3;
