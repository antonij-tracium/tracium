-- Pending invitations to join a workspace.
--
-- An invite is addressed to an email and carried by a single-use link token.
-- Accepting it requires both the token and a signed-in account whose email
-- matches, so a leaked link alone grants nothing. The owner shares the link
-- themselves; the core never sends mail.
--
-- As with api_keys, only the token's SHA-256 hash is stored — the plaintext is
-- returned to the owner once at creation — so a database leak exposes no usable
-- links. An invite is resolved exactly once: accepted_at or revoked_at is set,
-- and a row with either set (or past expires_at) no longer admits anyone. Rows
-- are kept rather than deleted as an audit trail of who was let in, and by whom.
--
-- workspace_id cascades on delete: an invite's only meaning is "join this
-- workspace", so it must die with the workspace.
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

-- At most one open invite per workspace and address. Re-inviting the same email
-- revokes the previous open invite first, so the newest link is the only one
-- that works.
CREATE UNIQUE INDEX IF NOT EXISTS workspace_invites_open_idx
 ON workspace_invites (workspace_id, email)
 WHERE accepted_at IS NULL AND revoked_at IS NULL;
