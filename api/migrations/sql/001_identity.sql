CREATE TABLE IF NOT EXISTS users (
 id UUID PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
 tenant_id TEXT NOT NULL, role TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS workspaces (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, slug TEXT NOT NULL,
 env TEXT NOT NULL, role TEXT NOT NULL, members INT NOT NULL DEFAULT 1,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS workspace_members (
 workspace_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY (workspace_id,user_id)
);
INSERT INTO workspace_members (workspace_id,user_id,role)
SELECT id,user_id,'owner' FROM workspaces ON CONFLICT (workspace_id,user_id) DO NOTHING;
