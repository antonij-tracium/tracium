package model

import "time"

// APIKey is a per-workspace credential used to authenticate trace ingestion.
//
// The key is scoped to one workspace: verifying it both authenticates the sender
// and resolves the workspace its spans belong to. CreatedBy names the account
// that minted the key, for provenance only — it grants no authority, so the key
// keeps working regardless of that account's membership or existence.
//
// The secret itself is never held here: it is returned to the caller once, at
// creation, and only its hash is stored (see the apikey package). This struct is
// the metadata safe to list back to a client — Prefix identifies the key in the
// UI without revealing it.
type APIKey struct {
	ID          string     `json:"id"`
	WorkspaceID string     `json:"workspace_id"`
	CreatedBy   string     `json:"created_by"`
	Name        string     `json:"name"`
	Prefix      string     `json:"prefix"`
	CreatedAt   time.Time  `json:"created_at"`
	LastUsedAt  *time.Time `json:"last_used_at"`
	RevokedAt   *time.Time `json:"revoked_at"`
}
