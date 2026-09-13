-- Per-workspace API keys for authenticating trace ingestion.
--
-- A key is scoped to exactly one workspace: it is the credential that both
-- authenticates a sender and determines which workspace its telemetry lands in,
-- so the sender no longer needs to name the workspace in the payload. created_by
-- records the account that minted the key, for provenance only — it carries no
-- authority, so removing or deleting that user never changes what the key can do.
--
-- The plaintext secret is shown to the caller exactly once at creation and never
-- stored; only its SHA-256 hash is persisted, so a database leak does not expose
-- usable keys. `prefix` is a short, non-secret slice of the token kept purely so
-- the UI can show which key is which. `revoked_at` soft-deletes a key:
-- verification ignores any row where it is set, keeping a stable audit trail
-- instead of hard-deleting.
--
-- workspace_id references the owning workspace with ON DELETE CASCADE: a key's
-- whole authority is "telemetry lands in this workspace", so once the workspace
-- is gone the key must stop authenticating. Without the cascade, verification
-- (which matches by key_hash and ignores only revoked_at) would keep accepting a
-- deleted workspace's keys and funnel data into a workspace that no longer exists.
CREATE TABLE IF NOT EXISTS api_keys (
 id UUID PRIMARY KEY,
 workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
 created_by TEXT NOT NULL,
 name TEXT NOT NULL,
 prefix TEXT NOT NULL,
 key_hash TEXT NOT NULL UNIQUE,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 last_used_at TIMESTAMPTZ,
 revoked_at TIMESTAMPTZ
);

-- Ingest verification looks a key up by its hash on every authenticated request,
-- so the hash column carries the hot path; the UNIQUE constraint above already
-- provides that index. This second index serves the per-workspace key list.
CREATE INDEX IF NOT EXISTS api_keys_workspace_id_idx ON api_keys (workspace_id);
