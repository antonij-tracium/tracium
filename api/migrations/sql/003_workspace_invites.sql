-- Invitations to join a workspace. Only the link token's SHA-256 hash is stored.
CREATE TABLE IF NOT EXISTS workspace_invites (
 id UUID PRIMARY KEY,
 workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
 email TEXT NOT NULL,
 role TEXT NOT NULL,
 token_hash TEXT NOT NULL UNIQUE,
 invited_by TEXT NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 expires_at TIMESTAMPTZ NOT NULL,
 accepted_at TIMESTAMPTZ,
 accepted_by TEXT,
 revoked_at TIMESTAMPTZ
);

-- One open invite per workspace and address.
CREATE UNIQUE INDEX IF NOT EXISTS workspace_invites_open_idx
 ON workspace_invites (workspace_id, email)
 WHERE accepted_at IS NULL AND revoked_at IS NULL;
