package workspace

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/tracium/api/internal/model"
)

// InviteTTL is how long an invite link stays valid.
const InviteTTL = 7 * 24 * time.Hour

// InviteTokenPrefix marks invite link tokens.
const InviteTokenPrefix = "trci_"

var (
	ErrInviteNotFound = errors.New("invite not found")
	// ErrInviteClosed means the invite was accepted, revoked, or has expired.
	ErrInviteClosed        = errors.New("invite is no longer valid")
	ErrInviteEmailMismatch = errors.New("invite was issued to a different email")
	ErrAlreadyMember       = errors.New("already a member")
)

// InviteStore persists workspace invitations, keyed by token hash.
type InviteStore interface {
	// CreateInvite revokes any open invite for the same email, then stores inv.
	CreateInvite(ctx context.Context, inv *model.WorkspaceInvite, tokenHash string) error
	ListInvites(ctx context.Context, workspaceID string) ([]model.WorkspaceInvite, error)
	// HasOpenInvite reports whether email has an open, unexpired invite to the workspace.
	HasOpenInvite(ctx context.Context, workspaceID, email string) (bool, error)
	RevokeInvite(ctx context.Context, workspaceID, inviteID string) error
	PreviewInvite(ctx context.Context, tokenHash string) (*model.InvitePreview, error)
	// AcceptInvite joins userID to the workspace if their email matches, and
	// returns the workspace id. A non-nil allow runs before the member is added,
	// and its error aborts the accept and is returned unchanged.
	AcceptInvite(ctx context.Context, tokenHash, userID string, allow func(ctx context.Context, workspaceID string) error) (string, error)
}

// ListMembers returns the workspace's members, oldest first.
func (s *PostgresStore) ListMembers(ctx context.Context, workspaceID string) ([]model.WorkspaceMember, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT m.user_id, u.email, m.role, m.created_at
		   FROM workspace_members m
		   JOIN users u ON u.id::text = m.user_id
		  WHERE m.workspace_id = $1
		  ORDER BY m.created_at, u.email`, workspaceID)
	if err != nil {
		return nil, fmt.Errorf("workspace store: list members: %w", err)
	}
	defer rows.Close()

	var members []model.WorkspaceMember
	for rows.Next() {
		var m model.WorkspaceMember
		if err := rows.Scan(&m.UserID, &m.Email, &m.Role, &m.JoinedAt); err != nil {
			return nil, fmt.Errorf("workspace store: scan member: %w", err)
		}
		members = append(members, m)
	}
	return members, rows.Err()
}

// CreateInvite implements InviteStore.
func (s *PostgresStore) CreateInvite(ctx context.Context, inv *model.WorkspaceInvite, tokenHash string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("workspace store: begin: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck // no-op after a successful Commit

	var member bool
	if err := tx.QueryRow(ctx,
		`SELECT EXISTS (
		   SELECT 1 FROM workspace_members m JOIN users u ON u.id::text = m.user_id
		    WHERE m.workspace_id = $1 AND u.email = $2)`,
		inv.WorkspaceID, inv.Email).Scan(&member); err != nil {
		return fmt.Errorf("workspace store: check member: %w", err)
	}
	if member {
		return ErrAlreadyMember
	}

	if _, err := tx.Exec(ctx,
		`UPDATE workspace_invites SET revoked_at = NOW()
		  WHERE workspace_id = $1 AND email = $2 AND accepted_at IS NULL AND revoked_at IS NULL`,
		inv.WorkspaceID, inv.Email); err != nil {
		return fmt.Errorf("workspace store: replace invite: %w", err)
	}
	if err := tx.QueryRow(ctx,
		`INSERT INTO workspace_invites (id, workspace_id, email, role, token_hash, invited_by, expires_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7)
		 RETURNING created_at`,
		inv.ID, inv.WorkspaceID, inv.Email, inv.Role, tokenHash, inv.InvitedBy, inv.ExpiresAt,
	).Scan(&inv.CreatedAt); err != nil {
		return fmt.Errorf("workspace store: create invite: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("workspace store: commit: %w", err)
	}
	return nil
}

// ListInvites returns the workspace's open invites, newest first.
func (s *PostgresStore) ListInvites(ctx context.Context, workspaceID string) ([]model.WorkspaceInvite, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT id, workspace_id, email, role, invited_by, created_at, expires_at
		   FROM workspace_invites
		  WHERE workspace_id = $1 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > NOW()
		  ORDER BY created_at DESC`, workspaceID)
	if err != nil {
		return nil, fmt.Errorf("workspace store: list invites: %w", err)
	}
	defer rows.Close()

	var invites []model.WorkspaceInvite
	for rows.Next() {
		var inv model.WorkspaceInvite
		if err := rows.Scan(&inv.ID, &inv.WorkspaceID, &inv.Email, &inv.Role, &inv.InvitedBy, &inv.CreatedAt, &inv.ExpiresAt); err != nil {
			return nil, fmt.Errorf("workspace store: scan invite: %w", err)
		}
		invites = append(invites, inv)
	}
	return invites, rows.Err()
}

// HasOpenInvite implements InviteStore.
func (s *PostgresStore) HasOpenInvite(ctx context.Context, workspaceID, email string) (bool, error) {
	var open bool
	err := s.pool.QueryRow(ctx,
		`SELECT EXISTS (
		   SELECT 1 FROM workspace_invites
		    WHERE workspace_id = $1 AND email = $2 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > NOW())`,
		workspaceID, email).Scan(&open)
	if err != nil {
		return false, fmt.Errorf("workspace store: check open invite: %w", err)
	}
	return open, nil
}

// RevokeInvite implements InviteStore.
func (s *PostgresStore) RevokeInvite(ctx context.Context, workspaceID, inviteID string) error {
	tag, err := s.pool.Exec(ctx,
		`UPDATE workspace_invites SET revoked_at = NOW()
		  WHERE id::text = $1 AND workspace_id = $2 AND accepted_at IS NULL AND revoked_at IS NULL`,
		inviteID, workspaceID)
	if err != nil {
		return fmt.Errorf("workspace store: revoke invite: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrInviteNotFound
	}
	return nil
}

// PreviewInvite implements InviteStore.
func (s *PostgresStore) PreviewInvite(ctx context.Context, tokenHash string) (*model.InvitePreview, error) {
	var (
		p                            model.InvitePreview
		accepted, revoked, isExpired bool
	)
	err := s.pool.QueryRow(ctx,
		`SELECT w.name, COALESCE(u.email, ''), i.email, i.expires_at,
		        i.accepted_at IS NOT NULL, i.revoked_at IS NOT NULL, i.expires_at <= NOW()
		   FROM workspace_invites i
		   JOIN workspaces w ON w.id = i.workspace_id
		   LEFT JOIN users u ON u.id::text = i.invited_by
		  WHERE i.token_hash = $1`, tokenHash,
	).Scan(&p.WorkspaceName, &p.InvitedByEmail, &p.Email, &p.ExpiresAt, &accepted, &revoked, &isExpired)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrInviteNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("workspace store: preview invite: %w", err)
	}
	if accepted || revoked || isExpired {
		return nil, ErrInviteClosed
	}
	return &p, nil
}

// AcceptInvite locks the invite row so a link can't be accepted twice.
func (s *PostgresStore) AcceptInvite(ctx context.Context, tokenHash, userID string, allow func(ctx context.Context, workspaceID string) error) (string, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return "", fmt.Errorf("workspace store: begin: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck // no-op after a successful Commit

	var (
		id, workspaceID, role string
		open, emailMatches    bool
	)
	err = tx.QueryRow(ctx,
		`SELECT i.id::text, i.workspace_id, i.role,
		        i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > NOW(),
		        COALESCE(lower(u.email) = i.email, false)
		   FROM workspace_invites i
		   LEFT JOIN users u ON u.id::text = $2
		  WHERE i.token_hash = $1
		    FOR UPDATE OF i`, tokenHash, userID,
	).Scan(&id, &workspaceID, &role, &open, &emailMatches)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrInviteNotFound
	}
	if err != nil {
		return "", fmt.Errorf("workspace store: load invite: %w", err)
	}
	if !open {
		return "", ErrInviteClosed
	}
	if !emailMatches {
		return "", ErrInviteEmailMismatch
	}
	if allow != nil {
		if err := allow(ctx, workspaceID); err != nil {
			return "", err
		}
	}

	if _, err := tx.Exec(ctx,
		`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, $3)
		 ON CONFLICT (workspace_id, user_id) DO NOTHING`,
		workspaceID, userID, role); err != nil {
		return "", fmt.Errorf("workspace store: add member: %w", err)
	}
	if _, err := tx.Exec(ctx,
		`UPDATE workspace_invites SET accepted_at = NOW(), accepted_by = $2 WHERE id::text = $1`,
		id, userID); err != nil {
		return "", fmt.Errorf("workspace store: close invite: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return "", fmt.Errorf("workspace store: commit: %w", err)
	}
	return workspaceID, nil
}
