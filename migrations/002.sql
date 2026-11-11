ALTER TABLE missions ADD COLUMN repository TEXT;
ALTER TABLE missions ADD COLUMN revision TEXT;
ALTER TABLE missions ADD COLUMN provider TEXT;
ALTER TABLE missions ADD COLUMN budget_reserved INTEGER NOT NULL DEFAULT 0;
ALTER TABLE missions ADD COLUMN plan_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE missions ADD COLUMN lease TEXT;
ALTER TABLE missions ADD COLUMN lease_until INTEGER NOT NULL DEFAULT 0;
CREATE TABLE repositories (
  name TEXT PRIMARY KEY, git_dir TEXT NOT NULL, revision TEXT NOT NULL,
  device TEXT NOT NULL, inode TEXT NOT NULL
);
CREATE TABLE mission_nodes (
  mission TEXT NOT NULL REFERENCES missions(id), id TEXT NOT NULL,
  role TEXT NOT NULL, task TEXT NOT NULL, dependencies TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
  output TEXT, PRIMARY KEY(mission,id)
);
CREATE TABLE agent_settings (
  role TEXT PRIMARY KEY, enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
  guidance TEXT NOT NULL
);
ALTER TABLE skills ADD COLUMN tool TEXT NOT NULL DEFAULT 'catalog_commit';
CREATE TABLE reauth_limit (id INTEGER PRIMARY KEY CHECK(id=1), attempts INTEGER NOT NULL, until INTEGER NOT NULL);
PRAGMA user_version=2;
